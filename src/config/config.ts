import { z } from 'zod';
import { commonSchema, instanceSchema, loadConfig } from './runtime';
export const configSchema = commonSchema
  .extend({
    instances: z
      .array(
        instanceSchema.extend({
          apiBaseUrl: z.url().default('https://api.home-connect.com'),
          authFile: z.string().min(1).optional(),
          authorizationCode: z.string().optional(),
          clientId: z.string().min(1),
          clientSecret: z.string().min(1),
          eventReconnectInterval: z.number().positive().default(30000),
          redirectUri: z
            .union([z.url(), z.literal('')])
            .optional()
            .transform((value) => value || undefined),
          refreshToken: z.string().optional(),
          updateInterval: z.number().positive().default(60000),
        }),
      )
      .min(1),
  })
  .superRefine((value, ctx) => unique(value.instances, ctx));
/**
 * Executes `unique`.
 * @param {{ id: string; topic: string; }[]} instances The instances value.
 * @param {$RefinementCtx<unknown>} ctx The ctx value.
 * @returns {void} Result.
 */
function unique(instances: { id: string; topic: string }[], ctx: z.RefinementCtx) {
  for (const [index, entry] of instances.entries())
    for (let prior = 0; prior < index; prior++)
      if (instances[prior].id === entry.id || instances[prior].topic === entry.topic)
        ctx.addIssue({ code: 'custom', path: ['instances', index], message: 'instance id and topic must be unique' });
}
export type HomeConnectConfig = z.infer<typeof configSchema>['instances'][number];
export const CONFIG = loadConfig(configSchema);
