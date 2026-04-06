"use client";

import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { MapPin, Globe, Building2 } from "lucide-react";

interface GoogleMapsDropdownProps {
  domain: string;
  nomEntreprise: string | null;
  adresse: string | null;
  ville: string | null;
}

function openMaps(query: string) {
  window.open(`https://www.google.com/maps/search/${encodeURIComponent(query)}`, "_blank");
}

export function GoogleMapsDropdown({ domain, nomEntreprise, adresse, ville }: GoogleMapsDropdownProps) {
  const fullAddress = [adresse, ville].filter(Boolean).join(", ");

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="icon" className="h-8 w-8" title="Google Maps">
          <MapPin className="h-4 w-4" />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {fullAddress && (
          <DropdownMenuItem onClick={() => openMaps(fullAddress)}>
            <MapPin className="h-3.5 w-3.5 mr-2" />
            Adresse
          </DropdownMenuItem>
        )}
        {nomEntreprise && (
          <DropdownMenuItem onClick={() => openMaps(nomEntreprise + (ville ? " " + ville : ""))}>
            <Building2 className="h-3.5 w-3.5 mr-2" />
            Nom entreprise
          </DropdownMenuItem>
        )}
        <DropdownMenuItem onClick={() => openMaps(domain)}>
          <Globe className="h-3.5 w-3.5 mr-2" />
          Domaine
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
