import { Draw, InputHelpPanel as InfoPanel } from 'gameforgejs/2d';

/**
 * The stage panel is the scene's `hud` UICanvas (scenes/*.gfscene.json, editable in the editor);
 * this fills its {bindings} and draws the input help guide.
 */
export class PlatformerHUD {
    /** @param {Object} screen @param {Object|null} canvas - The scene's HUD UICanvas. */
    constructor(screen, canvas) {
        this.canvas = canvas;
        this.help = new InfoPanel(new Draw(screen), { title: 'PLATFORMER FIELD GUIDE', y: 120, lines: [] });
    }

    /** Updates the canvas bindings; call before the canvas draws. */
    Bind(level) {
        let instruction = 'Collect all coins, then reach the flag';
        if (level.won) {
            instruction = level.stage.last
                ? 'Both stages complete! Enter / Start to play again.'
                : 'Stage complete! Enter / Start for the next stage.';
        }
        this.canvas?.Set({ title: level.stage.title, coins: level.collectedCount, total: level.coins.length, instruction });
    }

    Draw(level) {
        this.help.DrawAction('HELP', level.screen.Width - 145, 20);
        this.help.OnDrawn();
    }
}
