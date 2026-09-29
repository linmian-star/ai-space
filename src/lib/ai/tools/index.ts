import type { ResearchState } from '../research-state';
import type { VectorStore } from '../vector-store';
import { createSearchTool } from './search';
import { createFetchPageTool } from './fetch-page';
import { createFinishResearchTool } from './finish-research';

// Research Agent 工具集合工厂：传入当前请求的 ResearchState 和 VectorStore，
// 让 search / fetch_page / finish_research 在同一次请求内共享同一份预算、缓存与向量库；
// 不同请求之间不共享状态。
export function createResearchTools(state: ResearchState, vectorStore: VectorStore) {
  return {
    search: createSearchTool(state),
    fetch_page: createFetchPageTool(state, vectorStore),
    finish_research: createFinishResearchTool(state),
  };
}
