/** Categorical chart palette (validated light-mode order). Slot order is fixed. */
export const PALETTE = ["#257de0", "#f47230", "#00b894", "#f2a600", "#ee7fac", "#008a17", "#6a4ce2", "#ec4647"] as const;
export const PALETTE_DARK = ["#338ced", "#e76624", "#00a888", "#d28e05", "#e24d8b", "#0aac23", "#9887ef", "#eb6263"] as const;
export const OTHER_COLOR = "#9a9a9a";

export interface DefaultCategory {
  name: string;
  kind: "expense" | "income";
  icon: string;
  color: string;
  discretionary?: boolean;
}

export const DEFAULT_CATEGORIES: DefaultCategory[] = [
  { name: "Housing & Rent", kind: "expense", icon: "home", color: PALETTE[0] },
  { name: "Groceries", kind: "expense", icon: "shopping-basket", color: PALETTE[5] },
  { name: "Restaurants", kind: "expense", icon: "utensils", color: PALETTE[1], discretionary: true },
  { name: "Transportation", kind: "expense", icon: "car", color: PALETTE[2] },
  { name: "Utilities", kind: "expense", icon: "zap", color: PALETTE[3] },
  { name: "Shopping", kind: "expense", icon: "shopping-bag", color: PALETTE[4], discretionary: true },
  { name: "Entertainment", kind: "expense", icon: "clapperboard", color: PALETTE[6], discretionary: true },
  { name: "Healthcare", kind: "expense", icon: "heart-pulse", color: PALETTE[7] },
  { name: "Subscriptions", kind: "expense", icon: "repeat", color: PALETTE[0], discretionary: true },
  { name: "Education", kind: "expense", icon: "graduation-cap", color: PALETTE[1] },
  { name: "Travel", kind: "expense", icon: "plane", color: PALETTE[2], discretionary: true },
  { name: "Personal care", kind: "expense", icon: "sparkles", color: PALETTE[3], discretionary: true },
  { name: "Insurance", kind: "expense", icon: "shield", color: PALETTE[4] },
  { name: "Gifts & Donations", kind: "expense", icon: "gift", color: PALETTE[5] },
  { name: "Fees & Charges", kind: "expense", icon: "receipt", color: PALETTE[6] },
  { name: "Other", kind: "expense", icon: "circle-dashed", color: "#8a8a8a" },
  { name: "Salary", kind: "income", icon: "briefcase", color: PALETTE[5] },
  { name: "Freelance", kind: "income", icon: "laptop", color: PALETTE[0] },
  { name: "Investment income", kind: "income", icon: "trending-up", color: PALETTE[6] },
  { name: "Gifts received", kind: "income", icon: "gift", color: PALETTE[4] },
  { name: "Other income", kind: "income", icon: "plus-circle", color: "#8a8a8a" },
];

export const CATEGORY_ICONS = [
  "home", "shopping-basket", "utensils", "car", "zap", "shopping-bag", "clapperboard", "heart-pulse", "repeat",
  "graduation-cap", "plane", "sparkles", "shield", "gift", "receipt", "circle-dashed", "briefcase", "laptop",
  "trending-up", "plus-circle", "baby", "dog", "dumbbell", "coffee", "fuel", "wifi", "smartphone", "book",
  "music", "gamepad", "landmark", "wrench", "shirt", "bike",
] as const;

/**
 * Keyword dictionary for category suggestions when neither a rule nor the
 * user's own history matches. Keys are default category names.
 */
export const MERCHANT_KEYWORDS: Record<string, string[]> = {
  Subscriptions: ["netflix", "spotify", "youtube premium", "disney", "apple.com", "icloud", "prime video", "deezer", "shahid", "osn", "chatgpt", "adobe", "microsoft 365", "dropbox"],
  Groceries: ["marjane", "carrefour", "aswak", "label vie", "bim", "lidl", "aldi", "tesco", "acima", "supermarket", "grocery", "épicerie", "epicerie", "hanout"],
  Restaurants: ["restaurant", "mcdonald", "kfc", "burger", "pizza", "starbucks", "café", "cafe", "coffee", "glovo", "uber eats", "deliveroo", "sushi", "tacos"],
  Transportation: ["uber", "careem", "indrive", "taxi", "petrol", "fuel", "afriquia", "shell", "totalenergies", "oncf", "train", "tram", "bus", "parking", "autoroute", "péage", "peage"],
  Utilities: ["maroc telecom", "iam", "inwi", "orange", "lydec", "redal", "amendis", "onee", "electricity", "water", "internet", "fibre", "telecom", "gas bill"],
  Shopping: ["amazon", "zara", "h&m", "decathlon", "ikea", "jumia", "aliexpress", "electroplanet", "shein", "store", "mall"],
  Entertainment: ["cinema", "megarama", "pathé", "steam", "playstation", "xbox", "concert", "theatre", "museum", "bowling"],
  Healthcare: ["pharmacy", "pharmacie", "clinic", "clinique", "doctor", "médecin", "hospital", "dentist", "laboratoire", "optician"],
  Travel: ["airbnb", "booking.com", "ryanair", "royal air maroc", "easyjet", "hotel", "expedia", "air arabia", "transavia"],
  "Personal care": ["gym", "fitness", "salon", "barber", "coiffure", "spa", "hammam", "cosmetic", "sephora"],
  Insurance: ["insurance", "assurance", "axa", "wafa assurance", "saham", "allianz", "rma"],
  "Housing & Rent": ["rent", "loyer", "landlord", "syndic", "property management"],
  Education: ["school", "école", "ecole", "university", "udemy", "coursera", "tuition", "books", "librairie"],
  "Fees & Charges": ["bank fee", "frais", "commission", "atm fee", "overdraft", "interest charge"],
  Salary: ["salary", "payroll", "salaire", "paie", "wage"],
  Freelance: ["upwork", "fiverr", "freelance", "invoice", "client payment"],
  "Investment income": ["dividend", "interest", "coupon", "capital gain"],
};

export const DATE_FORMATS = ["dd MMM yyyy", "dd/MM/yyyy", "MM/dd/yyyy", "yyyy-MM-dd"] as const;
export const NUMBER_LOCALES = {
  "en-US": "1,234.56",
  "fr-FR": "1 234,56",
  "de-DE": "1.234,56",
  "en-GB": "1,234.56 (UK)",
} as const;

export const GOAL_KINDS = {
  emergency: "Emergency fund",
  vacation: "Vacation",
  motorcycle: "Motorcycle",
  car: "Car",
  house: "House deposit",
  debt: "Debt repayment",
  general: "General savings",
} as const;
