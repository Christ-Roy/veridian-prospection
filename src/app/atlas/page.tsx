import { redirect } from "next/navigation";

/** Ancienne adresse d'Atlas : l'app est désormais servie sur « / ». */
export default function AncienAtlas() {
  redirect("/");
}
