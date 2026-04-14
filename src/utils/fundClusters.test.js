import { describe, it, expect } from 'vitest';
import { clusterAllocations, getClusterEntries } from './fundClusters';

const clusters = [
  {
    id: 'ghd',
    name: 'Global Health & Development',
    color: '#85E4FF',
    members: ['givewell', 'leaf'],
  },
  {
    id: 'animal_welfare',
    name: 'Animal Welfare',
    color: '#85E4FF',
    members: ['nav_gen', 'nav_cf', 'ea_awf'],
  },
  {
    id: 'gcr',
    name: 'Global Catastrophic Risks',
    color: '#85E4FF',
    members: ['longview_ai', 'longview_nuclear', 'sentinel_bio'],
  },
];

describe('clusterAllocations', () => {
  it('sums member allocations into cluster totals', () => {
    const allocations = {
      givewell: 20,
      leaf: 10,
      nav_gen: 5,
      nav_cf: 5,
      ea_awf: 15,
      longview_ai: 30,
      longview_nuclear: 10,
      sentinel_bio: 5,
    };
    expect(clusterAllocations(allocations, clusters)).toEqual({
      ghd: 30,
      animal_welfare: 25,
      gcr: 45,
    });
  });

  it('treats missing members as 0', () => {
    const allocations = { givewell: 100 };
    const result = clusterAllocations(allocations, clusters);
    expect(result.ghd).toBe(100);
    expect(result.animal_welfare).toBe(0);
    expect(result.gcr).toBe(0);
  });

  it('handles fractional allocations without floating-point drift', () => {
    const allocations = { givewell: 33.33, leaf: 33.34 };
    const result = clusterAllocations(allocations, clusters);
    expect(result.ghd).toBe(66.67);
  });
});

describe('getClusterEntries', () => {
  it('returns causeEntries-shaped array with info from project names', () => {
    const projects = {
      givewell: { name: 'GiveWell' },
      leaf: { name: 'LEAF' },
      nav_gen: { name: 'Navigation General' },
      nav_cf: { name: 'Navigation Cage-Free' },
      ea_awf: { name: 'EA AWF' },
      longview_ai: { name: 'AI Fund' },
      longview_nuclear: { name: 'Nuclear Fund' },
      sentinel_bio: { name: 'Sentinel Bio' },
    };
    const entries = getClusterEntries(clusters, projects);
    expect(entries).toEqual([
      ['ghd', { name: 'Global Health & Development', color: '#85E4FF', info: 'GiveWell  \nLEAF' }],
      [
        'animal_welfare',
        {
          name: 'Animal Welfare',
          color: '#85E4FF',
          info: 'Navigation General  \nNavigation Cage-Free  \nEA AWF',
        },
      ],
      [
        'gcr',
        {
          name: 'Global Catastrophic Risks',
          color: '#85E4FF',
          info: 'AI Fund  \nNuclear Fund  \nSentinel Bio',
        },
      ],
    ]);
  });

  it('falls back to member ids when projects not provided', () => {
    const entries = getClusterEntries(clusters);
    expect(entries[0][1].info).toBe('givewell  \nleaf');
  });
});
