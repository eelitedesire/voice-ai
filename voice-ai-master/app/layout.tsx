import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'AI Co-Therapist',
  description: 'A voice-enabled therapeutic session assistant',
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="antialiased">
        {children}
      </body>
    </html>
  );
}
