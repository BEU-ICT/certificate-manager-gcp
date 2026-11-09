import { UnprocessableError } from '../../shared/errors.js';
import type { TemplateRenderer } from './renderer.js';

export const RENDER_ENGINE_UNSUPPORTED = 'RENDER_ENGINE_UNSUPPORTED';

export interface RendererRegistry {
  /** Throws when an engine with the same name is already registered. */
  register(renderer: TemplateRenderer): void;
  /** `UnprocessableError('RENDER_ENGINE_UNSUPPORTED')` for an unknown engine. */
  get(engine: string): TemplateRenderer;
}

export class InMemoryRendererRegistry implements RendererRegistry {
  private readonly renderers = new Map<string, TemplateRenderer>();

  register(renderer: TemplateRenderer): void {
    if (this.renderers.has(renderer.engine)) {
      throw new Error(`Render engine already registered: ${renderer.engine}`);
    }
    this.renderers.set(renderer.engine, renderer);
  }

  get(engine: string): TemplateRenderer {
    const renderer = this.renderers.get(engine);
    if (!renderer) {
      throw new UnprocessableError(
        RENDER_ENGINE_UNSUPPORTED,
        'The template uses a render engine that is not supported',
        [{ path: 'config.engine', message: RENDER_ENGINE_UNSUPPORTED }],
      );
    }
    return renderer;
  }
}
