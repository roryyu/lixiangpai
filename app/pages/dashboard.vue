<script setup lang="ts">
import { ArrowRight } from '@element-plus/icons-vue'

definePageMeta({
  layout: false,
})

const canvasRef = ref<HTMLCanvasElement | null>(null)
const particles = ref<any[]>([])
const animationPhase = ref<'chaotic' | 'transition' | 'harmony'>('chaotic')
const phaseProgress = ref(0)

interface Particle {
  x: number
  y: number
  vx: number
  vy: number
  targetX: number
  targetY: number
  radius: number
  color: string
}

const initParticles = (canvas: HTMLCanvasElement) => {
  const count = 80
  const particles: Particle[] = []
  
  const centerX = canvas.width / 2
  const centerY = canvas.height / 2
  
  for (let i = 0; i < count; i++) {
    const angle = (i / count) * Math.PI * 2
    const radius = 150 + Math.random() * 100
    
    particles.push({
      x: Math.random() * canvas.width,
      y: Math.random() * canvas.height,
      vx: (Math.random() - 0.5) * 4,
      vy: (Math.random() - 0.5) * 4,
      targetX: centerX + Math.cos(angle) * radius,
      targetY: centerY + Math.sin(angle) * radius,
      radius: 2 + Math.random() * 2,
      color: `rgba(34, 197, 94, ${0.6 + Math.random() * 0.4})`
    })
  }
  
  return particles
}

const updateParticle = (particle: Particle, canvas: HTMLCanvasElement) => {
  if (animationPhase.value === 'chaotic') {
    if (phaseProgress.value === 1) {
      particle.vx = (Math.random() - 0.5) * 4
      particle.vy = (Math.random() - 0.5) * 4
    }
    particle.x += particle.vx
    particle.y += particle.vy
    
    if (particle.x < 0 || particle.x > canvas.width) particle.vx *= -1
    if (particle.y < 0 || particle.y > canvas.height) particle.vy *= -1
  } else if (animationPhase.value === 'transition') {
    const dx = particle.targetX - particle.x
    const dy = particle.targetY - particle.y
    particle.x += dx * 0.02
    particle.y += dy * 0.02
  } else {
    const centerX = canvas.width / 2
    const centerY = canvas.height / 2
    const angle = Math.atan2(particle.targetY - centerY, particle.targetX - centerX)
    const currentRadius = Math.sqrt(
      Math.pow(particle.x - centerX, 2) + Math.pow(particle.y - centerY, 2)
    )
    const newAngle = angle + 0.005
    
    particle.x = centerX + Math.cos(newAngle) * currentRadius
    particle.y = centerY + Math.sin(newAngle) * currentRadius
  }
}

const drawConnections = (ctx: CanvasRenderingContext2D, particles: Particle[]) => {
  const maxDistance = 150
  
  for (let i = 0; i < particles.length; i++) {
    for (let j = i + 1; j < particles.length; j++) {
      const dx = particles[i].x - particles[j].x
      const dy = particles[i].y - particles[j].y
      const distance = Math.sqrt(dx * dx + dy * dy)
      
      if (distance < maxDistance) {
        const opacity = (1 - distance / maxDistance) * 0.6
        ctx.beginPath()
        ctx.strokeStyle = `rgba(34, 197, 94, ${opacity})`
        ctx.lineWidth = 1
        ctx.moveTo(particles[i].x, particles[i].y)
        ctx.lineTo(particles[j].x, particles[j].y)
        ctx.stroke()
      }
    }
  }
}

const drawParticles = (ctx: CanvasRenderingContext2D, particles: Particle[]) => {
  particles.forEach(particle => {
    ctx.beginPath()
    ctx.arc(particle.x, particle.y, particle.radius, 0, Math.PI * 2)
    ctx.fillStyle = particle.color
    ctx.fill()
  })
}

const animate = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  ctx.fillStyle = '#0a0a0a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  particles.value.forEach(p => updateParticle(p, canvas))
  drawConnections(ctx, particles.value)
  drawParticles(ctx, particles.value)
  
  phaseProgress.value += 1
  
  if (animationPhase.value === 'chaotic' && phaseProgress.value > 200) {
    animationPhase.value = 'transition'
    phaseProgress.value = 0
  } else if (animationPhase.value === 'transition' && phaseProgress.value > 300) {
    animationPhase.value = 'harmony'
    phaseProgress.value = 0
  } else if (animationPhase.value === 'harmony' && phaseProgress.value > 200) {
    animationPhase.value = 'chaotic'
    phaseProgress.value = 0
  }
  
  requestAnimationFrame(animate)
}

const handleResize = () => {
  const canvas = canvasRef.value
  if (!canvas) return
  
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  
  particles.value = initParticles(canvas)
}

onMounted(() => {
  const canvas = canvasRef.value
  if (!canvas) return
  
  canvas.width = window.innerWidth
  canvas.height = window.innerHeight
  
  particles.value = initParticles(canvas)
  animate()
  
  window.addEventListener('resize', handleResize)
})

onUnmounted(() => {
  window.removeEventListener('resize', handleResize)
})

const navigateToWorkspace = () => {
  navigateTo('/workspace')
}
</script>

<template>
  <div class="homepage">
    <canvas ref="canvasRef" class="background-canvas"></canvas>
    
    <div class="content-overlay">
      <div class="hero-section">
        <h1 class="title">理享派</h1>
        <p class="subtitle">从混沌到有序，生活和谐美好</p>
        <p class="description">
          
        </p>
        
        <el-button 
          type="success" 
          size="large" 
          class="enter-button"
          @click="navigateToWorkspace"
        >
          进入工作台
          <el-icon class="el-icon--right"><ArrowRight /></el-icon>
        </el-button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.homepage {
  position: relative;
  width: 100vw;
  height: 100vh;
  overflow: hidden;
  background: #0a0a0a;
}

.background-canvas {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
}

.content-overlay {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 10;
}

.hero-section {
  text-align: center;
  color: white;
  max-width: 600px;
  padding: 40px;
}

.title {
  font-size: 72px;
  font-weight: 800;
  margin: 0 0 20px 0;
  background: linear-gradient(135deg, #22c55e 0%, #4ade80 50%, #86efac 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
  letter-spacing: 8px;
}

.subtitle {
  font-size: 24px;
  margin: 0 0 16px 0;
  color: #86efac;
  font-weight: 300;
  letter-spacing: 4px;
}

.description {
  font-size: 16px;
  margin: 0 0 40px 0;
  color: #9ca3af;
  line-height: 1.8;
}

.enter-button {
  height: 56px;
  padding: 0 48px;
  font-size: 18px;
  font-weight: 600;
  border-radius: 28px;
  background: linear-gradient(135deg, #22c55e 0%, #16a34a 100%);
  border: none;
  box-shadow: 0 8px 32px rgba(34, 197, 94, 0.4);
  transition: all 0.3s ease;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  line-height: 1;
}

.enter-button:hover {
  transform: translateY(-2px);
  box-shadow: 0 12px 40px rgba(34, 197, 94, 0.5);
}
</style>
