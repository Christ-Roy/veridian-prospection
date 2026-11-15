# Atlas : vision (Robert, 15/11/2026)

Source unique de la vision. Elle vit aussi dans le CRM (descriptif du projet « Prospection · Atlas »),
recopiée depuis ce fichier : en cas d'écart, ce fichier fait foi.

## Ce qu'est Atlas

Un « Pappers des marchés » : on ne cherche pas une entreprise, on voit un marché entier (toutes les
entreprises de France, base maître d'ODH), on le découpe, on le priorise, on le suit.

## Pour qui, quel modèle (R1)

- **Lead magnet** à terme : un accès sans compte, des pages publiques par marché (pSEO) avec des préréglages
  d'affichage de la donnée.
- **Freemium généreux** : par exemple les emails d'un marché choisi, à la mesure de la capacité d'envoi de
  Notifuse.
- **Payant** : l'export de tout son marché ; le **taux de pénétration** de chaque marché (import de ses
  clients par SIRET en CSV) ; graphiques, données et recommandations de scoring par l'IA, à partir des
  ventes de l'entreprise.
- Atlas entre dans un **package avec toutes les apps SaaS Veridian**.

## La chaîne (R2)

**Atlas → Notifuse → CRM → ERP.** Atlas trouve et priorise ; Notifuse envoie en masse ; le CRM reçoit les
réponses et permet le cold call (export direct vers le CRM) ; l'ERP en bout.
Plus tard : analytics poussé sur la donnée de l'entreprise pour révéler ses marchés ; une **API** (puis un
SDK) pour brancher le marché en temps réel sur un ERP ou un autre outil, sans exporter la donnée, avec le
taux de pénétration ; à terme des routes d'API créées dynamiquement pour chaque marché, comme Twenty le
fait pour ses objets. Pour l'instant : une API.

## L'interface (R3)

Trouver la bonne interface et les KPI qui comptent, en restant pratique. L'IA construit des vues adaptées à
chaque demande, avec des composants prêts à l'emploi, et la possibilité d'en créer (plugins, comme Twenty).

## La donnée (R4, R5)

- Les métiers fins viendront d'un **classifieur d'ODH** (sites web et autres sources).
- **La qualité est le travail d'ODH** : Atlas affiche ODH tel quel ; la session ODH rend la donnée propre.

## Le reste

- R6 : l'ouverture à Henri et aux testeurs, Robert s'en occupe.
- R7 : aucun vrai utilisateur du SaaS : tout ce qui reste de l'ancienne app s'archive et part, base propre.
- R8 : **surprendre** Robert avec des données pertinentes.
