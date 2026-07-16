export type DiscoveryTargetRuntimeRisk = {
  credential: boolean;
  sensitivePayment: boolean;
  upload: boolean;
};

export type DiscoveryTargetRegistry = {
  resetDocument(documentToken: string): void;
  targetId(identityKey: string, risk?: DiscoveryTargetRuntimeRisk): string;
  resolve(
    targetId: string,
  ): { identityKey: string; documentToken: string; risk: DiscoveryTargetRuntimeRisk } | undefined;
  remove(targetId: string): void;
};

const NO_RISK: DiscoveryTargetRuntimeRisk = {
  credential: false,
  sensitivePayment: false,
  upload: false,
};

export function createDiscoveryTargetRegistry(idGenerator: () => string): DiscoveryTargetRegistry {
  let documentToken: string | undefined;
  const targetIdByIdentity = new Map<string, string>();
  const targetById = new Map<string, { identityKey: string; risk: DiscoveryTargetRuntimeRisk }>();

  return {
    resetDocument(nextToken) {
      if (documentToken === nextToken) return;
      documentToken = nextToken;
      targetIdByIdentity.clear();
      targetById.clear();
    },
    targetId(identityKey, risk = NO_RISK) {
      const existing = targetIdByIdentity.get(identityKey);
      if (existing !== undefined) {
        targetById.set(existing, { identityKey, risk: { ...risk } });
        return existing;
      }
      const created = idGenerator();
      targetIdByIdentity.set(identityKey, created);
      targetById.set(created, { identityKey, risk: { ...risk } });
      return created;
    },
    resolve(targetId) {
      const target = targetById.get(targetId);
      return target === undefined || documentToken === undefined
        ? undefined
        : { identityKey: target.identityKey, documentToken, risk: { ...target.risk } };
    },
    remove(targetId) {
      const identityKey = targetById.get(targetId)?.identityKey;
      targetById.delete(targetId);
      if (identityKey !== undefined) targetIdByIdentity.delete(identityKey);
    },
  };
}
