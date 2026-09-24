import { useContext } from "react";
import { SalonContext, type SalonContextValue } from "./SalonContext";

export function useSalon(): SalonContextValue {
  const ctx = useContext(SalonContext);
  if (!ctx) throw new Error("useSalon debe usarse dentro de <SalonProvider>");
  return ctx;
}
