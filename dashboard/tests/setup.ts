import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/preact';
import { afterEach } from 'vitest';

afterEach(cleanup);

// happy-dom does not provide a usable canvas 2D context. Chart.js' constructor
// is mocked in component tests, but our component still calls
// canvas.getContext('2d') and falls back to an error UI when it returns null.
// Provide a minimal stub so production code keeps a happy path under tests.
if (typeof HTMLCanvasElement !== 'undefined') {
  const proto = HTMLCanvasElement.prototype as unknown as {
    getContext: (type: string) => unknown;
  };
  proto.getContext = function getContext() {
    const noop = () => {};
    return {
      canvas: this,
      // Basic state
      save: noop,
      restore: noop,
      // Transforms (retinaScale path)
      setTransform: noop,
      resetTransform: noop,
      scale: noop,
      translate: noop,
      rotate: noop,
      transform: noop,
      // Paths
      beginPath: noop,
      closePath: noop,
      clip: noop,
      moveTo: noop,
      lineTo: noop,
      arc: noop,
      rect: noop,
      quadraticCurveTo: noop,
      bezierCurveTo: noop,
      // Drawing
      stroke: noop,
      fill: noop,
      clearRect: noop,
      fillRect: noop,
      strokeRect: noop,
      fillText: noop,
      strokeText: noop,
      drawImage: noop,
      // Style
      setLineDash: noop,
      getLineDash: () => [],
      // Measurement
      measureText: (text: string) => ({ width: text.length * 6 }),
      // Gradients & patterns
      createLinearGradient: () => ({ addColorStop: noop }),
      createRadialGradient: () => ({ addColorStop: noop }),
      createPattern: () => null,
      // Mutable style props Chart.js writes to
      fillStyle: '',
      strokeStyle: '',
      lineWidth: 1,
      lineCap: 'butt',
      lineJoin: 'miter',
      miterLimit: 10,
      lineDashOffset: 0,
      font: '',
      textAlign: 'start',
      textBaseline: 'alphabetic',
      direction: 'ltr',
      globalAlpha: 1,
      globalCompositeOperation: 'source-over',
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'low',
      shadowBlur: 0,
      shadowColor: 'rgba(0, 0, 0, 0)',
      shadowOffsetX: 0,
      shadowOffsetY: 0,
    };
  };
}
