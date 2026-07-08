'use client'

import { motion } from 'framer-motion'
import { ArrowLeft, Globe, Sparkles, ShieldCheck } from 'lucide-react'

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center relative overflow-hidden"
      style={{
        background: 'linear-gradient(135deg, #1a0a00 0%, #2d1200 25%, #0d0d0d 50%, #1a0800 75%, #0d0d0d 100%)',
      }}
    >
      {/* Animated background orbs */}
      <motion.div
        className="absolute top-[-20%] right-[-10%] w-[600px] h-[600px] rounded-full opacity-20 blur-[120px]"
        style={{ background: 'radial-gradient(circle, #f97316, #ea580c, transparent)' }}
        animate={{
          scale: [1, 1.2, 1],
          x: [0, -30, 0],
          y: [0, 20, 0],
        }}
        transition={{ duration: 8, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute bottom-[-20%] left-[-10%] w-[500px] h-[500px] rounded-full opacity-15 blur-[100px]"
        style={{ background: 'radial-gradient(circle, #fb923c, #f97316, transparent)' }}
        animate={{
          scale: [1.1, 1, 1.1],
          x: [0, 20, 0],
          y: [0, -30, 0],
        }}
        transition={{ duration: 10, repeat: Infinity, ease: 'easeInOut' }}
      />
      <motion.div
        className="absolute top-[40%] left-[50%] w-[300px] h-[300px] rounded-full opacity-10 blur-[80px]"
        style={{ background: 'radial-gradient(circle, #fdba74, #f97316, transparent)' }}
        animate={{
          scale: [1, 1.3, 1],
        }}
        transition={{ duration: 6, repeat: Infinity, ease: 'easeInOut' }}
      />

      {/* Grid pattern overlay */}
      <div
        className="absolute inset-0 opacity-[0.03]"
        style={{
          backgroundImage: `linear-gradient(rgba(249, 115, 22, 0.3) 1px, transparent 1px), linear-gradient(90deg, rgba(249, 115, 22, 0.3) 1px, transparent 1px)`,
          backgroundSize: '60px 60px',
        }}
      />

      {/* Floating particles */}
      {[...Array(6)].map((_, i) => (
        <motion.div
          key={i}
          className="absolute w-1 h-1 rounded-full bg-orange-400"
          style={{
            top: `${15 + i * 15}%`,
            left: `${10 + i * 16}%`,
            opacity: 0.3,
          }}
          animate={{
            y: [0, -20, 0],
            opacity: [0.2, 0.5, 0.2],
          }}
          transition={{
            duration: 3 + i * 0.5,
            repeat: Infinity,
            ease: 'easeInOut',
            delay: i * 0.3,
          }}
        />
      ))}

      {/* Main content card */}
      <motion.div
        className="relative z-10 mx-4 w-full max-w-lg"
        initial={{ opacity: 0, y: 40 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
      >
        {/* Glassmorphism card */}
        <div
          className="rounded-3xl p-8 sm:p-10 backdrop-blur-xl border"
          style={{
            background: 'rgba(249, 115, 22, 0.04)',
            borderColor: 'rgba(249, 115, 22, 0.15)',
            boxShadow: '0 0 80px rgba(249, 115, 22, 0.08), 0 25px 50px rgba(0, 0, 0, 0.4), inset 0 1px 0 rgba(249, 115, 22, 0.1)',
          }}
        >
          {/* Icon */}
          <motion.div
            className="flex justify-center mb-8"
            initial={{ scale: 0, rotate: -180 }}
            animate={{ scale: 1, rotate: 0 }}
            transition={{ duration: 0.7, delay: 0.2, type: 'spring', stiffness: 200 }}
          >
            <div
              className="w-20 h-20 rounded-2xl flex items-center justify-center relative"
              style={{
                background: 'linear-gradient(135deg, #f97316, #ea580c)',
                boxShadow: '0 0 40px rgba(249, 115, 22, 0.4), 0 0 80px rgba(249, 115, 22, 0.15)',
              }}
            >
              <Globe className="w-10 h-10 text-white" />
              <motion.div
                className="absolute -top-1 -right-1 w-5 h-5 rounded-full flex items-center justify-center"
                style={{ background: '#22c55e', boxShadow: '0 0 10px rgba(34, 197, 94, 0.5)' }}
                animate={{ scale: [1, 1.2, 1] }}
                transition={{ duration: 2, repeat: Infinity }}
              >
                <Sparkles className="w-3 h-3 text-white" />
              </motion.div>
            </div>
          </motion.div>

          {/* Title */}
          <motion.h1
            className="text-3xl sm:text-4xl font-bold text-center mb-4"
            style={{
              background: 'linear-gradient(135deg, #ffffff 0%, #fdba74 50%, #f97316 100%)',
              WebkitBackgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              lineHeight: '1.4',
            }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.4 }}
          >
            تم نقل الموقع
          </motion.h1>

          {/* Description */}
          <motion.p
            className="text-center text-base sm:text-lg mb-8 leading-relaxed"
            style={{ color: 'rgba(253, 186, 116, 0.7)' }}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.5 }}
          >
            لقد تم نقل الموقع إلى دومين جديد وتحديث جديد للدخول عليه اضغط على الزر تحت
          </motion.p>

          {/* CTA Button */}
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.6 }}
          >
            <a
              href="https://h1888.vercel.app/"
              target="_blank"
              rel="noopener noreferrer"
              className="group relative flex items-center justify-center gap-3 w-full py-4 px-8 rounded-2xl text-lg font-bold text-white overflow-hidden transition-all duration-300"
              style={{
                background: 'linear-gradient(135deg, #f97316, #ea580c)',
                boxShadow: '0 0 30px rgba(249, 115, 22, 0.3), 0 10px 40px rgba(234, 88, 12, 0.3)',
              }}
            >
              {/* Button shine effect */}
              <motion.div
                className="absolute inset-0 opacity-0 group-hover:opacity-100 transition-opacity duration-500"
                style={{
                  background: 'linear-gradient(135deg, transparent 0%, rgba(255,255,255,0.15) 50%, transparent 100%)',
                }}
                animate={{ x: ['-100%', '100%'] }}
                transition={{ duration: 2, repeat: Infinity, repeatDelay: 3 }}
              />
              <span className="relative z-10">انتقل إلى الموقع الجديد</span>
              <ArrowLeft className="w-5 h-5 relative z-10 transition-transform duration-300 group-hover:-translate-x-1" />
            </a>
          </motion.div>

          {/* Trust badges */}
          <motion.div
            className="flex items-center justify-center gap-4 mt-8 pt-6"
            style={{ borderTop: '1px solid rgba(249, 115, 22, 0.1)' }}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.6, delay: 0.8 }}
          >
            <div className="flex items-center gap-2" style={{ color: 'rgba(253, 186, 116, 0.4)' }}>
              <ShieldCheck className="w-4 h-4" />
              <span className="text-xs">اتصال آمن</span>
            </div>
            <div className="w-1 h-1 rounded-full bg-orange-500/20" />
            <div className="flex items-center gap-2" style={{ color: 'rgba(253, 186, 116, 0.4)' }}>
              <Globe className="w-4 h-4" />
              <span className="text-xs">سريع ومستقر</span>
            </div>
          </motion.div>
        </div>

        {/* Bottom decorative line */}
        <motion.div
          className="mx-auto mt-6 h-[2px] rounded-full"
          style={{
            width: '60%',
            background: 'linear-gradient(90deg, transparent, rgba(249, 115, 22, 0.3), transparent)',
          }}
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1, delay: 1 }}
        />
      </motion.div>
    </main>
  )
}