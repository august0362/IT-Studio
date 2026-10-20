import { ModelCapability, type ModelDescriptor, type ModelKey, type RoleAssignment } from '@itstudio/schemas';

export const ROLE_CAPABILITIES = {
  pm: [ModelCapability.CHAT, ModelCapability.JSON_MODE],
  coder: [ModelCapability.CHAT, ModelCapability.JSON_MODE, ModelCapability.CODE],
  reviewer: [ModelCapability.CHAT, ModelCapability.JSON_MODE],
} as const;

export function augmentPipelineRoles(
  assignment: RoleAssignment,
  models: readonly ModelDescriptor[],
  eligibleKeys: readonly ModelKey[],
): RoleAssignment {
  const ladder = (role: keyof RoleAssignment): readonly ModelKey[] => {
    const supports = (model: ModelDescriptor): boolean =>
      ROLE_CAPABILITIES[role].every((capability) => model.capabilities.includes(capability));
    return [
      ...new Set([
        ...assignment[role].filter((key) => {
          const model = models.find((item) => item.key === key);
          return model !== undefined && supports(model);
        }),
        ...models
          .filter((model) => model.enabled && eligibleKeys.includes(model.key) && supports(model))
          .map((model) => model.key),
      ]),
    ];
  };
  return { pm: ladder('pm'), coder: ladder('coder'), reviewer: ladder('reviewer') };
}
