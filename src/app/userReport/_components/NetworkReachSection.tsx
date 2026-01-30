'use client';

import { useMemo, useState } from 'react';
import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

import type { NetworkReachGroup } from '@/lib/user-report';

const COLORS = [
  '#4D4DFF', // vibrantBlue
  '#C4B5FD', // lightPurple
  '#A78BFA', // mediumPurple
  '#10B981', // success
  '#3B82F6', // chartLine1
  '#F472B6',
  '#FBBF24',
  '#FB923C',
];

type Props = {
  groups: NetworkReachGroup[];
};

export function NetworkReachSection({ groups }: Props) {
  const pieData = useMemo(
    () =>
      groups.map((group) => ({
        name: group.role,
        value: group.engagers.length,
        category: group.category,
      })),
    [groups],
  );

  const [selectedCategory, setSelectedCategory] = useState(
    () => pieData[0]?.category ?? null,
  );

  const followerFormatter = useMemo(
    () =>
      new Intl.NumberFormat('en-US', {
        maximumFractionDigits: 0,
      }),
    [],
  );

  const selectedGroup =
    groups.find((group) => group.category === selectedCategory) ?? null;

  return (
    <div className="space-y-6">
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="card-base p-5">
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  dataKey="value"
                  data={pieData}
                  cx="50%"
                  cy="50%"
                  innerRadius={70}
                  outerRadius={100}
                  paddingAngle={1}
                  onClick={(_, index) =>
                    setSelectedCategory(pieData[index]?.category ?? null)
                  }
                >
                  {pieData.map((entry, index) => (
                    <Cell
                      key={`cell-${entry.category}`}
                      fill={COLORS[index % COLORS.length]}
                      className="cursor-pointer"
                    />
                  ))}
                </Pie>
                <Tooltip
                   formatter={(value: number) => [`${value} profiles`, 'High-signal']}
                   contentStyle={{
                     backgroundColor: 'var(--popover)',
                     borderColor: 'var(--border)',
                     borderRadius: '6px',
                     color: 'var(--popover-foreground)',
                     boxShadow: 'var(--shadow-card)',
                   }}
                   itemStyle={{ color: 'var(--foreground)' }}
                   labelStyle={{ color: 'var(--muted-foreground)' }}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
          <p className="text-xs text-muted-foreground">
            Click a slice to inspect the underlying accounts.
          </p>
        </div>

        <div className="card-base p-5">
          {selectedGroup ? (
            <div className="space-y-4">
              <div>
                <p className="text-xs uppercase tracking-wide text-muted-foreground">
                  {selectedGroup.role}
                </p>
                <p className="text-sm text-foreground/80">
                  {selectedGroup.engagers.length} high-importance accounts
                </p>
              </div>
              <div className="grid gap-3">
                {selectedGroup.engagers.map((engager) => (
                  <div
                    key={engager.userId}
                    className="rounded-xl border border-border bg-muted/20 p-3"
                  >
                    <p className="text-sm font-semibold text-foreground">
                      {engager.name}{' '}
                      <span className="text-xs text-muted-foreground">
                        @{engager.username}
                      </span>
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {engager.engagementTypes.length > 0
                        ? engager.engagementTypes.join(', ')
                        : 'latent interest'}
                    </p>
                    <p className="mt-2 text-xs text-muted-foreground">
                      Importance {engager.importanceScore.toFixed(1)} ·{' '}
                      {followerFormatter.format(Math.round(engager.followers))}{' '}
                      followers
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">
              Select a slice to see the underlying accounts.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
