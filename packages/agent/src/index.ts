import { generateHeadlessVariants, type HeadlessVariantGenerationResult } from "@auto-demo/polish";
import {
  loadProject,
  type LoadedProject,
  type ProjectValidationError,
  type ProjectVariant,
} from "@auto-demo/project";

export type AgentPackageRole = "agent-workflow-wrapper";

export const agentPackageRole: AgentPackageRole = "agent-workflow-wrapper";

export type AgentWorkflowOptions = {
  projectPath: string;
  json: boolean;
  variantId?: string;
  generate?: "baseline";
  save?: "all" | string;
  sourceVariantId?: string;
  openEditor?: boolean;
  editor?: {
    host?: string;
    port?: number;
  };
};

export type AgentWorkflowErrorCode =
  | "missing_project_path"
  | "unsupported_agent_command"
  | "unsupported_agent_output"
  | "unknown_agent_argument"
  | "invalid_project"
  | "missing_variant"
  | "variant_not_found"
  | "unsupported_generation"
  | "generation_failed"
  | "editor_unavailable";

export type AgentWorkflowError = {
  code: AgentWorkflowErrorCode;
  message: string;
  projectErrorCode?: ProjectValidationError["code"];
};

export type AgentWorkflowArtifact =
  | {
      kind: "project-manifest";
      path: string;
    }
  | {
      kind: "variant";
      path: string;
    };

export type AgentWorkflowVariantSource = "selected" | "generated";

export type AgentWorkflowSummary = {
  ok: true;
  project: {
    projectPath: string;
    manifestPath: string;
    name: string;
  };
  variant: {
    id: string;
    path: string;
    source: AgentWorkflowVariantSource;
  };
  artifacts: AgentWorkflowArtifact[];
  warnings: Array<{ code: string; message: string }>;
  nextSteps: string[];
  editor?: {
    opened: true;
    url: string;
  };
};

export type AgentWorkflowFailure = {
  ok: false;
  project: {
    projectPath: string;
  };
  errors: AgentWorkflowError[];
};

export type AgentWorkflowResult = AgentWorkflowSummary | AgentWorkflowFailure;

export type AgentWorkflowGenerationResult = HeadlessVariantGenerationResult;

export type AgentWorkflowDependencies = {
  loadProject?: typeof loadProject;
  generateHeadlessVariants?: typeof generateHeadlessVariants;
  startEditorServer?: (options: { projectPath: string; host?: string; port?: number }) => Promise<{
    url: string;
    close: () => Promise<void>;
  }>;
};

export async function runAgentWorkflow(
  options: AgentWorkflowOptions,
  dependencies: AgentWorkflowDependencies = {},
): Promise<AgentWorkflowResult> {
  const projectPath = options.projectPath;
  if (projectPath.trim().length === 0) {
    return failure(projectPath, {
      code: "missing_project_path",
      message: "autodemo agent run requires --project <project-dir-or-manifest>.",
    });
  }

  if (!options.json) {
    return failure(projectPath, {
      code: "unsupported_agent_output",
      message: "autodemo agent run currently requires --json output.",
    });
  }

  const load = dependencies.loadProject ?? loadProject;
  const initialProject = await load(projectPath);
  if (!initialProject.ok) {
    return invalidProjectFailure(projectPath, initialProject.errors);
  }

  let project: LoadedProject = initialProject;
  let generatedVariantId: string | undefined;
  let generatedWarnings: AgentWorkflowSummary["warnings"] = [];
  let nextSteps = ["open-editor", "export-variant"];

  if (options.generate !== undefined) {
    if (options.generate !== "baseline" || options.save === undefined) {
      return failure(projectPath, {
        code: "unsupported_generation",
        message:
          "autodemo agent run supports only --generate baseline with --save <variant-id|all>.",
      });
    }

    const generate = dependencies.generateHeadlessVariants ?? generateHeadlessVariants;
    const generation = await generate({
      projectPath,
      json: true,
      styles: ["baseline"],
      sourceVariantId: options.sourceVariantId,
      save: true,
      mode: options.save === "all" ? "all" : undefined,
      selectedVariantId: options.save === "all" ? undefined : options.save,
    });

    if (!generation.ok) {
      return failure(
        projectPath,
        ...generation.errors.map((error) => ({
          code: "generation_failed" as const,
          message: error.message,
        })),
      );
    }

    const savedVariant = generation.summary.saved[0];
    if (savedVariant === undefined) {
      return failure(projectPath, {
        code: "variant_not_found",
        message: "Generation completed without a saved variant for agent handoff.",
      });
    }

    generatedVariantId = savedVariant.id;
    generatedWarnings = generation.variants.flatMap((variant) => variant.warnings);
    nextSteps = generation.summary.nextSteps;

    const reloadedProject = await load(projectPath);
    if (!reloadedProject.ok) {
      return invalidProjectFailure(projectPath, reloadedProject.errors);
    }
    project = reloadedProject;
  }

  const source: AgentWorkflowVariantSource =
    generatedVariantId === undefined ? "selected" : "generated";
  const selectedVariant = selectVariant(
    project.manifest.variants,
    generatedVariantId ?? options.variantId,
  );
  if (selectedVariant === undefined) {
    return failure(projectPath, {
      code:
        project.manifest.variants.length === 0 &&
        (generatedVariantId ?? options.variantId) === undefined
          ? "missing_variant"
          : "variant_not_found",
      message:
        project.manifest.variants.length === 0
          ? "Project does not contain a saved variant for agent handoff."
          : "Requested variant was not found in the project manifest.",
    });
  }

  const summary: AgentWorkflowSummary = {
    ok: true,
    project: {
      projectPath: project.projectDir,
      manifestPath: project.manifestPath,
      name: project.manifest.name,
    },
    variant: {
      id: selectedVariant.id,
      path: variantPath(selectedVariant.id),
      source,
    },
    artifacts: [
      { kind: "project-manifest", path: project.manifestPath },
      { kind: "variant", path: variantPath(selectedVariant.id) },
    ],
    warnings: generatedWarnings,
    nextSteps,
  };

  if (options.openEditor) {
    if (dependencies.startEditorServer === undefined) {
      return failure(projectPath, {
        code: "editor_unavailable",
        message: "Editor handoff is unavailable in this agent workflow environment.",
      });
    }

    try {
      const editor = await dependencies.startEditorServer({
        projectPath,
        host: options.editor?.host,
        port: options.editor?.port,
      });
      summary.editor = {
        opened: true,
        url: editor.url,
      };
    } catch {
      return failure(projectPath, {
        code: "editor_unavailable",
        message: "The local editor could not be started for agent handoff.",
      });
    }
  }

  return summary;
}

function selectVariant(
  variants: ProjectVariant[],
  requestedVariantId: string | undefined,
): ProjectVariant | undefined {
  if (requestedVariantId === undefined) {
    return variants[0];
  }

  return variants.find((variant) => variant.id === requestedVariantId);
}

function variantPath(variantId: string): string {
  return `variants/${variantId}.json`;
}

function invalidProjectFailure(
  projectPath: string,
  errors: ProjectValidationError[],
): AgentWorkflowFailure {
  return failure(
    projectPath,
    ...errors.map((error) => ({
      code: "invalid_project" as const,
      projectErrorCode: error.code,
      message: error.message,
    })),
  );
}

function failure(projectPath: string, ...errors: AgentWorkflowError[]): AgentWorkflowFailure {
  return {
    ok: false,
    project: { projectPath },
    errors,
  };
}
