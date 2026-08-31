import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: '家庭经济账｜双人收入与共同现金流计算器',
  description: '分别计算夫妻双方税后收入，合并评估家庭支出、储蓄目标、应急金与长期累计结余。',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
