import type { QuickFilterIconKey } from "@/lib/icon-registry";

export const CATEGORIES = [
  "Produce",
  "Meat & Fish",
  "Dairy & Eggs",
  "Bakery",
  "Pantry",
  "Frozen",
  "Drinks",
  "Other",
] as const;

export const UNITS = [
  "",
  "pcs",
  "g",
  "kg",
  "ml",
  "L",
  "cups",
  "tbsp",
  "tsp",
  "oz",
  "lb",
  "bunches",
  "cans",
  "bags",
  "boxes",
] as const;

export const QUICK_FILTERS = [
  { id: "today", label: "Today", icon: "calendar" },
  { id: "upcoming", label: "Next 7 Days", icon: "calendar-range" },
  { id: "ongoing", label: "Ongoing", icon: "receipt" },
  { id: "fav", label: "Favourites", icon: "star" },
  { id: "recent", label: "Recent", icon: "clock" },
] as const satisfies ReadonlyArray<{
  id: string;
  label: string;
  icon: QuickFilterIconKey;
}>;

export type QuickFilter = (typeof QUICK_FILTERS)[number]["id"];

export type GroceryItem = {
  id: string;
  name: string;
  qty: string | null;
  unit: string | null;
  category: string;
  notes: string | null;
  meal: string | null;
  checked: boolean;
  sortOrder: number;
  pantryLink?: {
    id: string;
    pantryItemId: string;
    groceryItemId: string;
    status: string;
    active: boolean;
  } | null;
};

export type GroceryList = {
  id: string;
  name: string;
  date: string | null;
  favourite: boolean;
  createdAt: string;
  updatedAt: string;
  checkedCount: number;
  totalItems: number;
  completionPercentage: number;
  items: GroceryItem[];
};

export const ONGOING_LABEL = "Ongoing";

export const formatListDate = (value: string | Date | null) => {
  if (!value) {
    return ONGOING_LABEL;
  }

  return new Date(value).toLocaleDateString("default", {
    month: "short",
    day: "numeric",
  });
};

export const compareGroceryLists = (left: GroceryList, right: GroceryList) => {
  const leftOngoing = left.date === null;
  const rightOngoing = right.date === null;

  if (leftOngoing && rightOngoing) {
    return (
      new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime()
    );
  }

  if (leftOngoing) {
    return -1;
  }

  if (rightOngoing) {
    return 1;
  }

  const dateDiff =
    new Date(left.date as string).getTime() -
    new Date(right.date as string).getTime();
  if (dateDiff !== 0) {
    return dateDiff;
  }

  return new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime();
};

export const sortGroceryLists = (lists: GroceryList[]) =>
  [...lists].sort(compareGroceryLists);

export const isToday = (dt: string | Date | null) =>
  !!dt && new Date(dt).toDateString() === new Date().toDateString();

export const isUpcoming = (dt: string | Date | null, days = 7) => {
  if (!dt) {
    return false;
  }

  const diff = (new Date(dt).getTime() - Date.now()) / (1000 * 60 * 60 * 24);
  return diff >= 0 && diff <= days;
};

export const listProgress = (items: GroceryItem[]) => {
  if (!items.length) {
    return 0;
  }

  return Math.round(
    (items.filter((item) => item.checked).length / items.length) * 100
  );
};

export const groupByCategory = (items: GroceryItem[]) => {
  const map: Record<string, GroceryItem[]> = {};
  CATEGORIES.forEach((category) => {
    map[category] = [];
  });

  items.forEach((item) => {
    if (!map[item.category]) {
      map[item.category] = [];
    }
    map[item.category].push(item);
  });

  return Object.entries(map).filter(([, value]) => value.length > 0);
};

export const deriveGroceryList = (
  list: GroceryList,
  updatedAt = new Date().toISOString()
): GroceryList => {
  const checkedCount = list.items.filter((item) => item.checked).length;
  const totalItems = list.items.length;

  return {
    ...list,
    checkedCount,
    totalItems,
    completionPercentage:
      totalItems === 0 ? 0 : Math.round((checkedCount / totalItems) * 100),
    updatedAt,
  };
};

export const upsertGroceryList = (
  lists: GroceryList[],
  nextList: GroceryList
) => {
  const index = lists.findIndex((list) => list.id === nextList.id);

  if (index === -1) {
    return sortGroceryLists([
      ...lists,
      deriveGroceryList(nextList, nextList.updatedAt),
    ]);
  }

  return sortGroceryLists(
    lists.map((list) =>
      list.id === nextList.id
        ? deriveGroceryList(nextList, nextList.updatedAt)
        : list
    )
  );
};

export const updateGroceryListInCollection = (
  lists: GroceryList[],
  listId: string,
  updater: (list: GroceryList) => GroceryList
) =>
  sortGroceryLists(
    lists.map((list) =>
      list.id === listId ? deriveGroceryList(updater(list)) : list
    )
  );

export const removeGroceryListFromCollection = (
  lists: GroceryList[],
  listId: string
) => lists.filter((list) => list.id !== listId);

export const moveItem = <T>(items: T[], fromIndex: number, toIndex: number) => {
  const next = [...items];
  const [moved] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, moved);
  return next;
};
