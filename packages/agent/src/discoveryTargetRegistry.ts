export type DiscoveryTargetRegistry = {
  resetDocument(documentToken: string): void;
  targetId(identityKey: string): string;
  resolve(targetId: string): { identityKey: string; documentToken: string } | undefined;
  remove(targetId: string): void;
};

export function createDiscoveryTargetRegistry(idGenerator: () => string): DiscoveryTargetRegistry {
  let documentToken: string | undefined;
  const targetIdByIdentity = new Map<string, string>();
  const identityByTargetId = new Map<string, string>();

  return {
    resetDocument(nextToken) {
      if (documentToken === nextToken) return;
      documentToken = nextToken;
      targetIdByIdentity.clear();
      identityByTargetId.clear();
    },
    targetId(identityKey) {
      const existing = targetIdByIdentity.get(identityKey);
      if (existing !== undefined) return existing;
      const created = idGenerator();
      targetIdByIdentity.set(identityKey, created);
      identityByTargetId.set(created, identityKey);
      return created;
    },
    resolve(targetId) {
      const identityKey = identityByTargetId.get(targetId);
      return identityKey === undefined || documentToken === undefined
        ? undefined
        : { identityKey, documentToken };
    },
    remove(targetId) {
      const identityKey = identityByTargetId.get(targetId);
      identityByTargetId.delete(targetId);
      if (identityKey !== undefined) targetIdByIdentity.delete(identityKey);
    },
  };
}
