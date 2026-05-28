// desktop/eval/contract/families/brainstorm.ts
import type { ContractRule } from '../contract-test';

const ideaClustersMin1: ContractRule = {
  id: 'brainstorm-idea-clusters-min-1',
  severity: 'error',
  description: 'A Brainstorm note with 0 idea_clusters is empty.',
  run: ({ note }) => {
    const n = Array.isArray(note.idea_clusters) ? note.idea_clusters.length : 0;
    return { pass: n >= 1, message: `idea_clusters=${n}, want ≥1`, detail: { n } };
  },
};

const ideasPerCluster: ContractRule = {
  id: 'brainstorm-ideas-per-cluster',
  severity: 'error',
  description: 'Each idea_cluster must contain ≥2 ideas (a cluster of 1 is just an idea).',
  run: ({ note }) => {
    const clusters: any[] = note.idea_clusters ?? [];
    const thin = clusters.filter(c => !Array.isArray(c.ideas) || c.ideas.length < 2);
    return {
      pass: thin.length === 0,
      message: thin.length === 0
        ? 'all clusters have ≥2 ideas'
        : `${thin.length} thin cluster(s) (themes: ${thin.map((c: any) => c.theme).join(', ')})`,
      detail: { thinClusters: thin.length },
    };
  },
};

const uniqueIdeaIds: ContractRule = {
  id: 'brainstorm-unique-idea-ids',
  severity: 'error',
  description: 'Each idea.id must be unique (post-decode UUID assignment).',
  run: ({ note }) => {
    const clusters: any[] = note.idea_clusters ?? [];
    const ids: string[] = clusters.flatMap(c => (c.ideas ?? []).map((i: any) => i.id)).filter(Boolean);
    const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
    return {
      pass: dup.length === 0 && ids.length > 0,
      message: dup.length > 0
        ? `${dup.length} duplicate id(s): ${[...new Set(dup)].slice(0, 3).join(', ')}`
        : `${ids.length} unique ids`,
    };
  },
};

const ideaCountInRange: ContractRule = {
  id: 'brainstorm-idea-count-ground-truth',
  severity: 'warning',
  description: 'Total idea count within 50%-150% of ground-truth ideaCount.',
  run: ({ note, groundTruth }) => {
    if (groundTruth?.ideaCount === undefined) return { pass: true, message: 'no ground-truth ideaCount, rule N/A' };
    const clusters: any[] = note.idea_clusters ?? [];
    const total = clusters.reduce((s, c) => s + (c.ideas?.length ?? 0), 0);
    const lo = Math.floor(groundTruth.ideaCount * 0.5);
    const hi = Math.ceil(groundTruth.ideaCount * 1.5);
    return {
      pass: total >= lo && total <= hi,
      message: `idea count=${total} (ground-truth=${groundTruth.ideaCount}, accept [${lo}, ${hi}])`,
      detail: { total, lo, hi },
    };
  },
};

export const BRAINSTORM_RULES: ContractRule[] = [
  ideaClustersMin1,
  ideasPerCluster,
  uniqueIdeaIds,
  ideaCountInRange,
];
