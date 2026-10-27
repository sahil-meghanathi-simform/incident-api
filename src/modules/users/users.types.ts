export interface InvestigatorRow {
  id: string;
  displayName: string;
  role: 'REPORTER' | 'TRIAGE_MANAGER' | 'INVESTIGATOR' | 'ADMIN';
  clearanceLevel: number;
  isActive: boolean;
}
