/** Serializable shapes shared between server pages and client components. */
export interface AccountOption {
  id: string;
  name: string;
  currency: string;
  type: string;
  cls: "asset" | "liability";
  isArchived: boolean;
}
export interface CategoryOption {
  id: string;
  name: string;
  kind: "expense" | "income";
  icon: string;
  color: string;
  isArchived?: boolean;
}
export interface TagOption {
  id: string;
  name: string;
}
