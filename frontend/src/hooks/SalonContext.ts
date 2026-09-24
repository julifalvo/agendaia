import { createContext } from "react";
import type { ApiSalon } from "../types/api";

export interface SalonContextValue {
  salon: ApiSalon | null;
  loading: boolean;
}

export const SalonContext = createContext<SalonContextValue | undefined>(undefined);
