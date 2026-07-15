import { useState } from 'react'
import { Loader2, AlertCircle } from 'lucide-react'
import { supabase } from '../lib/supabase'
import logoFull from '../assets/logo.png'

export function Login() {
  const [email, setEmail]       = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState<string | null>(null)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)
    const { error: err } = await supabase.auth.signInWithPassword({ email, password })
    if (err) {
      setError('אימייל או סיסמה שגויים. אנא נסה שוב.')
      setLoading(false)
    }
  }

  return (
    <div dir="rtl" className="min-h-screen bg-background flex items-center justify-center p-4">
      <div className="w-full max-w-sm">

        <div className="flex justify-center mb-8">
          <img src={logoFull} alt="Admin Platform" className="h-12 w-auto" />
        </div>

        <div className="bg-surface rounded-2xl border border-gray-100 shadow-sm p-8">
          <h1 className="text-xl font-bold text-primary mb-1">כניסה למערכת</h1>
          <p className="text-sm text-gray-400 mb-6">הזן את פרטי הכניסה שלך</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                אימייל
              </label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                required
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-gray-300 transition"
              />
            </div>

            <div>
              <label className="block text-xs font-medium text-gray-600 mb-1.5">
                סיסמה
              </label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                dir="ltr"
                className="w-full px-3.5 py-2.5 text-sm rounded-xl border border-gray-200 bg-white focus:outline-none focus:border-primary focus:ring-2 focus:ring-primary/15 placeholder:text-gray-300 transition"
              />
            </div>

            {error && (
              <div className="flex items-center gap-2 text-xs text-red-600 bg-red-50 border border-red-100 rounded-xl px-3.5 py-2.5">
                <AlertCircle size={14} className="shrink-0" />
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full bg-primary hover:bg-primary/90 text-white text-sm font-semibold py-2.5 rounded-xl transition-colors disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2 mt-2"
            >
              {loading && <Loader2 size={15} className="animate-spin" />}
              {loading ? 'מתחבר...' : 'כניסה'}
            </button>
          </form>
        </div>

        <p className="text-center text-xs text-gray-300 mt-6">
          מערכת ניהול — גישה מורשית בלבד
        </p>
      </div>
    </div>
  )
}
