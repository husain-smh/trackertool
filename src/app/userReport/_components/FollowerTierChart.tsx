'use client';

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  CartesianGrid,
  XAxis,
  YAxis,
  Tooltip,
} from 'recharts';

import type { FollowerTier } from '@/lib/user-report';

type Props = {
  tiers: FollowerTier[];
};

export function FollowerTierChart({ tiers }: Props) {
  if (!tiers || tiers.length === 0) {
    return (
      <div className="card-base flex items-center justify-center min-h-[300px]">
        <p className="text-sm text-muted-foreground">
          No follower tier data yet. Re-run tweet analysis to populate this view.
        </p>
      </div>
    );
  }

  const data = tiers.map((tier) => ({
    tier: tier.tier,
    count: tier.count,
  }));

  // Keep bars consistently blue (vivid + readable)
  const BAR_FILL = 'var(--chart-1)';

  return (
    <div className="card-base">
      <h3 className="text-lg font-semibold text-foreground mb-4">Follower Count Tiers</h3>
      <ResponsiveContainer width="100%" height={300}>
        <BarChart data={data}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis 
            dataKey="tier" 
            stroke="var(--muted-foreground)" 
            fontSize={11} 
            tickLine={false} 
            axisLine={false} 
            dy={10}
          />
          <YAxis 
            stroke="var(--muted-foreground)" 
            fontSize={11} 
            tickLine={false} 
            axisLine={false} 
          />
          <Tooltip
            cursor={{ fill: 'var(--muted)', opacity: 0.2 }}
            contentStyle={{
              backgroundColor: 'var(--popover)',
              borderColor: 'var(--border)',
              borderRadius: '6px',
              color: 'var(--popover-foreground)',
              boxShadow: 'var(--shadow-card)',
              padding: '8px 12px',
            }}
            labelStyle={{ color: 'var(--muted-foreground)', marginBottom: '4px' }}
            itemStyle={{ color: 'var(--foreground)', fontWeight: 500 }}
          />
          <Bar 
            dataKey="count" 
            fill={BAR_FILL}
            radius={[4, 4, 0, 0]} 
            barSize={40}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
