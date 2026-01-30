'use client';

import { useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';

import type {
  ProfileDistribution,
  ProfileCategoryKey,
} from '@/lib/user-report';

const CATEGORY_CONFIG: {
  key: ProfileCategoryKey;
  label: string;
  color: string;
}[] = [
  { key: 'founders', label: 'Founders / CEOs', color: '#4D4DFF' },
  { key: 'vcs', label: 'Investors & VCs', color: '#C4B5FD' },
  { key: 'ai_creators', label: 'AI Creators', color: '#10B981' },
  { key: 'media', label: 'Media & Press', color: '#3B82F6' },
  { key: 'developers', label: 'Developers', color: '#F472B6' },
  { key: 'c_level', label: 'C-Level Operators', color: '#FBBF24' },
  { key: 'yc_alumni', label: 'YC Alumni', color: '#FB923C' },
  { key: 'others', label: 'General Audience', color: '#9CA3AF' },
];

type Props = {
  distribution: ProfileDistribution;
};

export function ProfileTypeDistributionSection({ distribution }: Props) {
  const total = distribution.totalEngagers;

  const pieData = useMemo(
    () =>
      CATEGORY_CONFIG.map((cfg) => {
        const category = distribution.categories.find(
          (c) => c.key === cfg.key,
        );
        return {
          key: cfg.key,
          name: cfg.label,
          color: cfg.color,
          value: category?.count ?? 0,
          percentage: category?.percentage ?? 0,
        };
      }).filter((item) => item.value > 0),
    [distribution],
  );

  const [selectedKey, setSelectedKey] = useState<ProfileCategoryKey | null>(
    () => (pieData[0] ? (pieData[0].key as ProfileCategoryKey) : null),
  );

  const selectedCategory = useMemo(() => {
    if (!selectedKey) return null;
    return distribution.categories.find((c) => c.key === selectedKey) ?? null;
  }, [distribution, selectedKey]);

  const followerFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0,
      }),
    [],
  );

  if (!total || pieData.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        We don&apos;t have enough engager data yet to build a profile distribution.
      </p>
    );
  }

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-base p-5">
          <div className="flex items-center justify-between mb-2 gap-2">
            <h4 className="text-sm font-semibold text-foreground">
              Profile Type Distribution
            </h4>
            <button
              type="button"
              className="shrink-0 w-5 h-5 rounded-full border border-muted-foreground/30 text-[10px] text-muted-foreground flex items-center justify-center hover:bg-muted hover:text-foreground"
              title="One account can belong to multiple groups (e.g. YC founder & investor). Slices show share of labels across all unique engagers."
            >
              i
            </button>
          </div>
          <p className="text-xs text-muted-foreground mb-4">
            Based on all unique engagers across every analyzed tweet. Click a
            segment to see who is in that group.
          </p>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  outerRadius={110}
                  innerRadius={70}
                  dataKey="value"
                  labelLine={false}
                  label={({ name, percent }) =>
                    `${name}: ${(percent * 100).toFixed(0)}%`
                  }
                  onClick={(_, index) => {
                    const item = pieData[index];
                    if (!item) return;
                    setSelectedKey((prev) =>
                      prev === item.key ? null : (item.key as ProfileCategoryKey),
                    );
                  }}
                >
                  {pieData.map((entry) => {
                    const isActive =
                      selectedKey && entry.key === selectedKey;
                    return (
                      <Cell
                        key={entry.key}
                        fill={entry.color}
                        stroke={isActive ? 'var(--background)' : 'transparent'}
                        strokeWidth={isActive ? 2 : 0}
                        className="cursor-pointer"
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  formatter={(value: number, _name, payload) => {
                    const pct =
                      typeof payload?.payload?.percentage === 'number'
                        ? payload.payload.percentage
                        : (value / total) * 100;
                    return [
                      `${value} profiles (${pct.toFixed(1)}%)`,
                      'Engagers',
                    ];
                  }}
                  contentStyle={{
                    backgroundColor: 'var(--popover)',
                    borderRadius: '6px',
                    border: '1px solid var(--border)',
                    color: 'var(--popover-foreground)',
                    boxShadow: 'var(--shadow-card)',
                  }}
                  labelStyle={{
                    color: 'var(--muted-foreground)',
                  }}
                  itemStyle={{
                    color: 'var(--foreground)',
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card-base p-5">
          {selectedCategory ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <p className="text-xs uppercase tracking-wide text-muted-foreground">
                    {CATEGORY_CONFIG.find((c) => c.key === selectedCategory.key)
                      ?.label ?? selectedCategory.label}
                  </p>
                  <p className="text-sm text-foreground/80">
                    {selectedCategory.count} accounts ·{' '}
                    {selectedCategory.percentage.toFixed(1)}% of unique
                    engagers
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => setSelectedKey(null)}
                  className="text-xs text-muted-foreground hover:text-foreground underline"
                >
                  Clear
                </button>
              </div>

              <div className="max-h-72 overflow-y-auto space-y-2 pr-1">
                {selectedCategory.engagers
                  .slice()
                  .sort(
                    (a, b) =>
                      (b.importanceScore || 0) - (a.importanceScore || 0),
                  )
                  .map((engager) => (
                    <div
                      key={engager.userId}
                      className="rounded-xl border border-border bg-muted/20 p-3"
                    >
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <p className="text-sm font-semibold text-foreground">
                            {engager.name}{' '}
                            <span className="text-xs text-muted-foreground">
                              @{engager.username}
                            </span>
                          </p>
                          {engager.bio && (
                            <p className="text-xs text-muted-foreground mt-1 line-clamp-2">
                              {engager.bio}
                            </p>
                          )}
                        </div>
                        <div className="text-right text-xs text-muted-foreground">
                          <div>
                            {followerFormatter.format(
                              Math.round(engager.followers || 0),
                            )}{' '}
                            followers
                          </div>
                          {typeof engager.importanceScore === 'number' &&
                            engager.importanceScore > 0 && (
                              <div>
                                Imp. {engager.importanceScore.toFixed(1)}
                              </div>
                            )}
                        </div>
                      </div>
                    </div>
                  ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Click a slice in the chart to inspect the underlying accounts.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
