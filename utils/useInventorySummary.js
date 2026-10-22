import { useRelationalPage } from './useRelationalPage';
import { relationalInventoryAPI } from './relationalInventoryApi';

// One aggregate result uses the same request/scope lifecycle as a single page.
const readSummary = ({ limit: _limit, offset: _offset, ...query }) => relationalInventoryAPI.getSummary(query)
  .then(rows => ({ items: [{ id: 'inventory-summary', rows }], total: 1 }));

export const useInventorySummary = (query = {}, enabled = true) => {
  const page = useRelationalPage(readSummary, query, enabled);
  return { rows: page.items[0]?.rows ?? null, loading: page.loading || page.initializing, error: page.error, refresh: page.refresh };
};
