import { ShieldOff } from 'lucide-react'

export function AccessDenied({ onBack }: { onBack?: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center h-96 gap-4 text-gray-400">
      <ShieldOff size={48} className="opacity-20" />
      <p className="text-base font-medium">אין לך גישה לעמוד הזה</p>
      <p className="text-sm text-gray-300">צור קשר עם מנהל המערכת לקבלת הרשאות</p>
      {onBack && (
        <button
          onClick={onBack}
          className="text-sm text-primary hover:text-primary-dark font-medium transition-colors mt-2"
        >
חזרה
        </button>
      )}
    </div>
  )
}
