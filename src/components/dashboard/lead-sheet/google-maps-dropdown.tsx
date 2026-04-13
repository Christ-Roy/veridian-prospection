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
        <Button variant="outline" className="h-10 px-3 gap-1.5 text-xs font-medium" title="Google Maps">
          <svg className="h-5 w-5" viewBox="0 0 92.3 132.3" xmlns="http://www.w3.org/2000/svg">
            <path fill="#1a73e8" d="M60.2 2.2C55.8.8 51 0 46.1 0 32 0 19.3 6.4 10.8 16.5l21.8 18.3L60.2 2.2z"/>
            <path fill="#ea4335" d="M10.8 16.5C4.1 24.5 0 34.9 0 46.1c0 8.7 1.7 15.7 4.6 22l28-33.3L10.8 16.5z"/>
            <path fill="#4285f4" d="M46.2 28.5c9.8 0 17.7 7.9 17.7 17.7 0 4.3-1.6 8.3-4.2 11.4 0 0 13.9-16.6 27.5-32.7-5.6-10.8-15.3-19-27-22.7L32.6 34.8c3.3-3.8 8.1-6.3 13.6-6.3"/>
            <path fill="#fbbc04" d="M46.2 63.8c-9.8 0-17.7-7.9-17.7-17.7 0-4.3 1.6-8.3 4.2-11.4L4.6 68.1c5.1 11.2 13.6 19.5 21.2 28.7L59.7 57.6c-3.2 3.8-8.1 6.2-13.5 6.2"/>
            <path fill="#34a853" d="M59.1 109.2c15.4-24.1 33.3-35 33.3-63 0-7.7-1.9-14.9-5.2-21.3L25.8 96.8c2.8 3.7 5.4 7.7 7.2 12.2 5.7 14 5.6 21.8 13.1 21.8 7.4.1 7.4-7.7 13-21.6"/>
          </svg>
          Maps
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
