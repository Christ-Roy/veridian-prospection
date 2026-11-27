/** Recherche par métier : seuls les codes NAF officiels sont proposés ; « 0000Z » (bouche-trou d'ODH) jamais (regard client, 27/11). */
import { expect, test } from "vitest";

import { codesActivite } from "@/atlas/source";

test("forme NAF et libellé officiel ; ni 0000Z, ni code inventé ; sans doublon", () => {
  expect(codesActivite(["1071C", "0000Z", "1071B", "9999Z", "abc", "1071C", "0170Z"])).toEqual(["1071C", "1071B", "0170Z"]);
});
