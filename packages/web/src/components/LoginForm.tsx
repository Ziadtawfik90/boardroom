import { useState, useEffect, useRef } from 'react';
import { motion } from 'framer-motion';
import { Lock, ArrowRight, Loader2 } from 'lucide-react';
import { login } from '../lib/auth';

interface LoginFormProps {
  onSuccess: () => void;
}

// Floating particles background
function ParticleField() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animId: number;
    const particles: Array<{ x: number; y: number; vx: number; vy: number; size: number; opacity: number }> = [];
    const PARTICLE_COUNT = 40;

    function resize() {
      canvas!.width = window.innerWidth;
      canvas!.height = window.innerHeight;
    }
    resize();
    window.addEventListener('resize', resize);

    // Init particles
    for (let i = 0; i < PARTICLE_COUNT; i++) {
      particles.push({
        x: Math.random() * canvas.width,
        y: Math.random() * canvas.height,
        vx: (Math.random() - 0.5) * 0.3,
        vy: (Math.random() - 0.5) * 0.3,
        size: Math.random() * 1.5 + 0.5,
        opacity: Math.random() * 0.3 + 0.05,
      });
    }

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      // Draw connections
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx = particles[i]!.x - particles[j]!.x;
          const dy = particles[i]!.y - particles[j]!.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 150) {
            ctx!.beginPath();
            ctx!.strokeStyle = `rgba(212, 175, 55, ${0.04 * (1 - dist / 150)})`;
            ctx!.lineWidth = 0.5;
            ctx!.moveTo(particles[i]!.x, particles[i]!.y);
            ctx!.lineTo(particles[j]!.x, particles[j]!.y);
            ctx!.stroke();
          }
        }
      }

      // Draw particles
      for (const p of particles) {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > canvas!.width) p.vx *= -1;
        if (p.y < 0 || p.y > canvas!.height) p.vy *= -1;
        ctx!.beginPath();
        ctx!.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx!.fillStyle = `rgba(212, 175, 55, ${p.opacity})`;
        ctx!.fill();
      }

      animId = requestAnimationFrame(draw);
    }
    draw();

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener('resize', resize);
    };
  }, []);

  return <canvas ref={canvasRef} className="fixed inset-0 pointer-events-none" />;
}

export function LoginForm({ onSuccess }: LoginFormProps) {
  const [apiKey, setApiKey] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!apiKey.trim()) return;

    setError('');
    setLoading(true);

    try {
      await login(apiKey.trim());
      onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#08080d] px-4 relative overflow-hidden">
      <ParticleField />

      {/* Ambient glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[800px] rounded-full opacity-[0.03] pointer-events-none"
        style={{ background: 'radial-gradient(circle, #d4af37 0%, transparent 60%)' }}
      />

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.6, ease: [0.16, 1, 0.3, 1] }}
        className="relative w-full max-w-[380px]"
      >
        {/* Logo */}
        <div className="text-center mb-12">
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ delay: 0.1, duration: 0.5 }}
            className="inline-flex items-center justify-center w-14 h-14 mb-6 border border-[#d4af37]/20 rounded-lg bg-[#d4af37]/[0.04]"
          >
            <div className="grid grid-cols-2 gap-1">
              <div className="w-2 h-2 rounded-sm bg-[#4ade80]/60" />
              <div className="w-2 h-2 rounded-sm bg-[#a78bfa]/60" />
              <div className="w-2 h-2 rounded-sm bg-[#fb923c]/60" />
              <div className="w-2 h-2 rounded-sm bg-[#d4af37]/60" />
            </div>
          </motion.div>

          <h1 className="text-[22px] font-light text-white/90 tracking-[0.35em] uppercase">
            The Boardroom
          </h1>
          <div className="mt-3 w-12 h-px bg-gradient-to-r from-transparent via-[#d4af37]/40 to-transparent mx-auto" />
          <p className="text-[11px] text-white/25 mt-4 tracking-[0.25em] uppercase">
            Multi-Agent Command System
          </p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="space-y-5">
          <div>
            <label
              htmlFor="apiKey"
              className="flex items-center gap-1.5 text-[10px] font-medium text-white/30 mb-2.5 tracking-[0.2em] uppercase"
            >
              <Lock className="w-3 h-3" />
              Access Key
            </label>
            <input
              id="apiKey"
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder="Enter your access key"
              autoFocus
              autoComplete="current-password"
              className="w-full border border-white/[0.06] bg-white/[0.02] px-4 py-3.5 text-sm text-white/90
                         placeholder:text-white/15 focus:border-[#d4af37]/30 focus:bg-white/[0.03] focus:outline-none
                         transition-all duration-200 rounded-lg"
            />
          </div>

          {error && (
            <motion.p
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-red-400/80 text-xs tracking-wide bg-red-500/[0.06] border border-red-500/10 rounded-md px-3 py-2"
              role="alert"
            >
              {error}
            </motion.p>
          )}

          <button
            type="submit"
            disabled={loading || !apiKey.trim()}
            className="group w-full flex items-center justify-center gap-2.5 border border-[#d4af37]/25 bg-[#d4af37]/[0.06] px-4 py-3.5
                       text-[12px] font-medium text-[#d4af37] tracking-[0.2em] uppercase rounded-lg
                       hover:bg-[#d4af37]/[0.1] hover:border-[#d4af37]/40 hover:shadow-[0_0_30px_rgba(212,175,55,0.06)]
                       focus:outline-none disabled:opacity-20 disabled:cursor-not-allowed
                       transition-all duration-300"
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <>
                Enter Boardroom
                <ArrowRight className="w-3.5 h-3.5 transition-transform group-hover:translate-x-0.5" />
              </>
            )}
          </button>
        </form>

        {/* Footer */}
        <p className="text-center text-[10px] text-white/10 mt-8 tracking-wider">
          3 Agents &middot; Distributed Compute &middot; Secure WebSocket
        </p>
      </motion.div>
    </div>
  );
}
