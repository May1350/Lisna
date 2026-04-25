export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja">
      <body style={{ fontFamily: 'system-ui, -apple-system, sans-serif', maxWidth: 800, margin: '40px auto', padding: '0 20px' }}>
        {children}
      </body>
    </html>
  )
}
