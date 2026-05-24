/**
 * Façade testing pour les fonctions internes de pipeline.ts.
 *
 * NE PAS importer depuis le code applicatif — réservé aux tests Vitest.
 * Permet d'asserter sur le hook recordPipelineTransition (sabotage-test du
 * comportement "no-op si stage inchangé") sans dépendre du prisma réel.
 */
import { __pipelineTestingInternals } from "./pipeline";

export const __testing = __pipelineTestingInternals;
