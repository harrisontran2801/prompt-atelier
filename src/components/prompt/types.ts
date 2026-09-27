export type Role = { id: string; name: string; detail: string; initials: string; color: string };
export type PromptFields = {
  directive: string;
  context: string;
  task: string;
  guardrails: string;
  output: string;
};
export type PromptDoc = {
  id: string;
  title: string;
  roleId: string;
  fields: PromptFields;
  updated: string;
};
