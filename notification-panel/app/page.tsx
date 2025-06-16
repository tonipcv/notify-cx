'use client'

import { useState } from 'react'

export default function Home() {
  const [title, setTitle] = useState('Cxlus')
  const [message, setMessage] = useState('')
  const [sending, setSending] = useState(false)
  const [result, setResult] = useState<{ success?: boolean; message?: string } | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setSending(true)
    setResult(null)

    try {
      const response = await fetch('https://aa-ios-notify-cxlus.dpbdp1.easypanel.host/send-notification', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          title,
          message,
        }),
      })

      const data = await response.json()
      
      setResult({
        success: response.ok,
        message: response.ok ? 'Notificação enviada com sucesso!' : data.error || 'Erro ao enviar notificação',
      })
    } catch (error) {
      setResult({
        success: false,
        message: 'Erro ao conectar com o servidor',
      })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="min-h-screen bg-[#f6f6ef]">
      <div className="max-w-2xl mx-auto px-4">
        {/* Header */}
        <header className="bg-[#ff6600] py-2 px-2 mb-4">
          <h1 className="text-lg font-normal text-white">Painel de Notificações</h1>
        </header>

        {/* Main Content */}
        <main className="bg-white p-4 border border-gray-200">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label htmlFor="title" className="block text-sm text-gray-800 mb-1 font-normal">
                Título
              </label>
              <input
                type="text"
                id="title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="w-full px-2 py-1 border border-gray-300 text-sm focus:outline-none focus:border-gray-500"
                required
              />
            </div>

            <div>
              <label htmlFor="message" className="block text-sm text-gray-800 mb-1 font-normal">
                Mensagem
              </label>
              <textarea
                id="message"
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={4}
                className="w-full px-2 py-1 border border-gray-300 text-sm focus:outline-none focus:border-gray-500"
                required
                placeholder="Digite sua mensagem aqui..."
              />
            </div>

            <button
              type="submit"
              disabled={sending}
              className={`px-4 py-1 text-sm ${
                sending
                  ? 'bg-gray-300 text-gray-500 cursor-not-allowed'
                  : 'bg-[#ff6600] text-white hover:bg-[#ff7720]'
              }`}
            >
              {sending ? 'Enviando...' : 'Enviar Notificação'}
            </button>
          </form>

          {/* Status Message */}
          {result && (
            <div className={`mt-4 p-2 text-sm ${
              result.success ? 'text-green-800 bg-green-50' : 'text-red-800 bg-red-50'
            }`}>
              {result.message}
            </div>
          )}

          {/* Preview */}
          <div className="mt-8 border-t border-gray-200 pt-4">
            <h3 className="text-sm text-gray-600 mb-2">Preview</h3>
            <div className="bg-[#f6f6ef] p-3 border border-gray-200">
              <div className="text-sm font-medium text-gray-900">{title || 'Título da Notificação'}</div>
              <div className="text-sm text-gray-600 mt-1">{message || 'Sua mensagem aparecerá aqui'}</div>
            </div>
          </div>

          {/* Footer */}
          <footer className="mt-8 pt-4 border-t border-gray-200 text-xs text-gray-500">
            <p>Envie notificações push para seus usuários de forma simples e direta.</p>
          </footer>
        </main>
      </div>
    </div>
  )
}
