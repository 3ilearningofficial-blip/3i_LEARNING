export type DbClient = {
  query: (text: string, params?: unknown[]) => Promise<{ rows: any[] }>;
};
