export function appendQueryParamsToPath(
  path: string,
  params: Record<string, string | undefined>,
) {
  const raw = (path || "").trim();
  const safePath = raw || "/";
  const [pathAndQuery, hashPart] = safePath.split("#", 2);
  const [pathname, queryPart] = pathAndQuery.split("?", 2);
  const searchParams = new URLSearchParams(queryPart || "");

  Object.entries(params).forEach(([key, value]) => {
    if (typeof value === "string" && value.trim().length > 0) {
      searchParams.set(key, value.trim());
      return;
    }
    searchParams.delete(key);
  });

  const query = searchParams.toString();
  const hash = hashPart ? `#${hashPart}` : "";
  return `${pathname || "/"}${query ? `?${query}` : ""}${hash}`;
}
