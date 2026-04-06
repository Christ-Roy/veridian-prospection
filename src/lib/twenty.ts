// Client GraphQL pour Twenty CRM
// Mapping scan.db → Twenty Companies + People + Notes

const TWENTY_API_URL = process.env.TWENTY_API_URL!;
const TWENTY_API_KEY = process.env.TWENTY_API_KEY!;

// --- Effectifs INSEE → nombre ---

const EFFECTIFS_TO_NUMBER: Record<string, number> = {
  "00": 0, "01": 1, "02": 4, "03": 7, "11": 15, "12": 35,
  "21": 75, "22": 150, "31": 225, "32": 375, "41": 750,
  "42": 1500, "51": 3500, "52": 7500, "53": 10000,
};

function effectifsToNumber(code: string | null): number | null {
  if (!code || code === "NN") return null;
  return EFFECTIFS_TO_NUMBER[code] ?? null;
}

// --- Types internes ---

export interface ExportLead {
  domain: string;
  /** Vrai domaine web (entreprises.web_domain_normalized), optionnel. */
  web_domain?: string | null;
  nom_entreprise: string;
  api_adresse: string | null;
  api_ville: string | null;
  api_code_postal: string | null;
  api_effectifs: string | null;
  api_ca: number | null;
  social_linkedin: string | null;
  social_twitter: string | null;
  api_dirigeant_prenom: string | null;
  api_dirigeant_nom: string | null;
  api_dirigeant_qualite: string | null;
  dirigeant_email: string | null;
  email_principal: string | null;
  phone_principal: string | null;
  outreach_notes: string | null;
  outreach_status: string | null;
  contacted_date: string | null;
  qualification: number | null;
}

export interface ExportResult {
  companies: { created: number; errors: string[] };
  people: { created: number; errors: string[] };
  notes: { created: number; errors: string[] };
}

// --- GraphQL helper ---

async function gql<T>(query: string, variables?: Record<string, unknown>): Promise<T> {
  const res = await fetch(`${TWENTY_API_URL}/graphql`, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${TWENTY_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ query, variables }),
  });

  const json = await res.json();
  if (json.errors) {
    throw new Error(json.errors.map((e: { message: string }) => e.message).join("; "));
  }
  return json.data as T;
}

// --- Mutations ---

const CREATE_COMPANIES_MUTATION = `
  mutation CreateCompanies($data: [CompanyCreateInput!]!, $upsert: Boolean) {
    createCompanies(data: $data, upsert: $upsert) {
      id
      name
      domainName { primaryLinkUrl }
    }
  }
`;

const CREATE_PERSON_MUTATION = `
  mutation CreatePerson($data: PersonCreateInput!, $upsert: Boolean) {
    createPerson(data: $data, upsert: $upsert) {
      id
      name { firstName lastName }
      companyId
    }
  }
`;

const CREATE_NOTE_MUTATION = `
  mutation CreateNote($data: NoteCreateInput!) {
    createNote(data: $data) {
      id
    }
  }
`;

const CREATE_NOTE_TARGET_MUTATION = `
  mutation CreateNoteTarget($data: NoteTargetCreateInput!) {
    createNoteTarget(data: $data) {
      id
    }
  }
`;

const GET_COMPANY_PEOPLE_QUERY = `
  query GetCompanyPeople($filter: CompanyFilterInput) {
    companies(filter: $filter) {
      edges {
        node {
          id
          domainName { primaryLinkUrl }
          people {
            edges {
              node {
                id
                name { firstName lastName }
                qualification
              }
            }
          }
        }
      }
    }
  }
`;

const UPDATE_PERSON_MUTATION = `
  mutation UpdatePerson($id: UUID!, $data: PersonUpdateInput!) {
    updatePerson(id: $id, data: $data) {
      id
      qualification
    }
  }
`;

// --- Mapping ---

function mapLeadToCompany(lead: ExportLead) {
  const company: Record<string, unknown> = {
    name: lead.nom_entreprise || `SIREN ${lead.domain}`,
    // Post-SIREN refactor: envoyer le vrai web_domain si dispo, sinon null
    // (Twenty accepte un domainName vide). Ne jamais forger `https://${siren}`.
    domainName: lead.web_domain
      ? { primaryLinkUrl: `https://${lead.web_domain}`, primaryLinkLabel: "" }
      : { primaryLinkUrl: "", primaryLinkLabel: "" },
    idealCustomerProfile: true,
  };

  if (lead.api_ville || lead.api_code_postal || lead.api_adresse) {
    company.address = {
      addressStreet1: lead.api_adresse || "",
      addressCity: lead.api_ville || "",
      addressPostcode: lead.api_code_postal || "",
      addressCountry: "France",
    };
  }

  const emp = effectifsToNumber(lead.api_effectifs);
  if (emp !== null) company.employees = emp;

  if (lead.social_linkedin) {
    company.linkedinLink = {
      primaryLinkUrl: lead.social_linkedin,
      primaryLinkLabel: "LinkedIn",
    };
  }

  if (lead.social_twitter) {
    company.xLink = {
      primaryLinkUrl: lead.social_twitter,
      primaryLinkLabel: "X",
    };
  }

  if (lead.api_ca && lead.api_ca > 0) {
    company.annualRecurringRevenue = {
      amountMicros: lead.api_ca * 1_000_000,
      currencyCode: "EUR",
    };
  }

  return company;
}

function mapLeadToPerson(lead: ExportLead, companyId: string) {
  const person: Record<string, unknown> = {
    name: {
      firstName: lead.api_dirigeant_prenom || "",
      lastName: lead.api_dirigeant_nom || "",
    },
    companyId,
  };

  const email = lead.dirigeant_email || lead.email_principal;
  if (email) {
    person.emails = { primaryEmail: email };
  }

  if (lead.phone_principal) {
    person.phones = {
      primaryPhoneNumber: lead.phone_principal,
      primaryPhoneCountryCode: "FR",
      primaryPhoneCallingCode: "+33",
    };
  }

  if (lead.api_dirigeant_qualite) {
    person.jobTitle = lead.api_dirigeant_qualite;
  }

  if (lead.api_ville) {
    person.city = lead.api_ville;
  }

  if (lead.qualification != null) {
    person.qualification = lead.qualification;
  }

  return person;
}

// --- Export principal ---

const BATCH_SIZE = 60;

export async function exportToTwenty(leads: ExportLead[]): Promise<ExportResult> {
  const result: ExportResult = {
    companies: { created: 0, errors: [] },
    people: { created: 0, errors: [] },
    notes: { created: 0, errors: [] },
  };

  // 1. Batch create companies
  const companyMap = new Map<string, string>(); // domain → twenty company id

  for (let i = 0; i < leads.length; i += BATCH_SIZE) {
    const batch = leads.slice(i, i + BATCH_SIZE);
    const companiesData = batch.map(mapLeadToCompany);

    try {
      const data = await gql<{
        createCompanies: Array<{ id: string; name: string; domainName: { primaryLinkUrl: string } }>;
      }>(CREATE_COMPANIES_MUTATION, { data: companiesData, upsert: true });

      for (const c of data.createCompanies) {
        const url = c.domainName.primaryLinkUrl;
        const domain = url.replace(/^https?:\/\//, "").replace(/\/$/, "");
        companyMap.set(domain, c.id);
        result.companies.created++;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.companies.errors.push(`Batch ${i / BATCH_SIZE + 1}: ${msg}`);
    }
  }

  // 2. Create people (dirigeants) one by one — linked to their company
  for (const lead of leads) {
    if (!lead.api_dirigeant_prenom && !lead.api_dirigeant_nom) continue;

    const companyId = companyMap.get(lead.domain);
    if (!companyId) continue;

    const personData = mapLeadToPerson(lead, companyId);

    try {
      await gql(CREATE_PERSON_MUTATION, { data: personData, upsert: true });
      result.people.created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.people.errors.push(`${lead.domain}: ${msg}`);
    }
  }

  // 3. Create notes (outreach notes → Note + NoteTarget on company)
  for (const lead of leads) {
    if (!lead.outreach_notes) continue;

    const companyId = companyMap.get(lead.domain);
    if (!companyId) continue;

    // Build markdown body with context
    const parts: string[] = [];
    if (lead.outreach_status && lead.outreach_status !== "a_contacter") {
      parts.push(`**Statut** : ${lead.outreach_status}`);
    }
    if (lead.contacted_date) {
      parts.push(`**Date contact** : ${lead.contacted_date}`);
    }
    parts.push("", lead.outreach_notes);

    try {
      const noteData = await gql<{ createNote: { id: string } }>(
        CREATE_NOTE_MUTATION,
        {
          data: {
            title: "Notes de prospection",
            bodyV2: { markdown: parts.join("\n") },
          },
        }
      );

      await gql(CREATE_NOTE_TARGET_MUTATION, {
        data: {
          noteId: noteData.createNote.id,
          companyId,
        },
      });

      result.notes.created++;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      result.notes.errors.push(`${lead.domain}: ${msg}`);
    }
  }

  return result;
}

// --- Qualification : lecture ---

export interface PersonQualification {
  personId: string;
  domain: string;
  firstName: string;
  lastName: string;
  qualification: number | null;
}

/**
 * Resolve SIREN → web_domain batch lookup from the entreprises table.
 * Post-SIREN refactor helper: the UI now sends SIREN values, but Twenty
 * Companies were created with `domainName.primaryLinkUrl = https://<web_domain>`.
 * We need to translate SIREN → web_domain before hitting the Twenty API.
 */
export async function resolveSirensToWebDomains(
  sirens: string[]
): Promise<Map<string, string>> {
  // Lazy import to avoid creating a circular dep if twenty.ts is imported from
  // a script that doesn't have prisma yet.
  const { prisma } = await import("@/lib/prisma");
  if (sirens.length === 0) return new Map();
  const rows = await prisma.$queryRawUnsafe<
    Array<{ siren: string; web_domain: string | null }>
  >(
    `SELECT siren, web_domain_normalized as web_domain
     FROM entreprises
     WHERE siren = ANY($1::text[])
       AND web_domain_normalized IS NOT NULL`,
    sirens
  );
  const map = new Map<string, string>();
  for (const r of rows) {
    if (r.web_domain) map.set(r.siren, r.web_domain);
  }
  return map;
}

export async function getQualifications(sirens: string[]): Promise<PersonQualification[]> {
  if (!TWENTY_API_URL || !TWENTY_API_KEY) return [];
  if (sirens.length === 0) return [];

  // Step 1: resolve SIREN → web_domain batch
  const sirenToDomain = await resolveSirensToWebDomains(sirens);

  const results: PersonQualification[] = [];

  // Step 2: for each SIREN that resolved to a web_domain, query Twenty
  for (const siren of sirens) {
    const webDomain = sirenToDomain.get(siren);
    if (!webDomain) continue; // No Twenty Company for this SIREN (no website)

    try {
      const data = await gql<{
        companies: {
          edges: Array<{
            node: {
              id: string;
              domainName: { primaryLinkUrl: string };
              people: {
                edges: Array<{
                  node: {
                    id: string;
                    name: { firstName: string; lastName: string };
                    qualification: number | null;
                  };
                }>;
              };
            };
          }>;
        };
      }>(GET_COMPANY_PEOPLE_QUERY, {
        filter: {
          domainName: { primaryLinkUrl: { eq: `https://${webDomain}` } },
        },
      });

      for (const companyEdge of data.companies.edges) {
        for (const personEdge of companyEdge.node.people.edges) {
          const person = personEdge.node;
          results.push({
            personId: person.id,
            // Return the SIREN the caller passed (not the web_domain), so the
            // UI can map results back to the rows it displayed.
            domain: siren,
            firstName: person.name.firstName,
            lastName: person.name.lastName,
            qualification: person.qualification,
          });
        }
      }
    } catch {
      // Domain not in Twenty CRM — skip silently
    }
  }

  return results;
}

// --- Qualification : mise à jour ---

export async function updateQualification(personId: string, qualification: number): Promise<void> {
  await gql(UPDATE_PERSON_MUTATION, {
    id: personId,
    data: { qualification },
  });
}
