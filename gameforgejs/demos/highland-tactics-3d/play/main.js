import { BootstrapGame } from 'gameforgejs/core';
import { HighlandModule } from './src/modules/HighlandModule.js';
import { HighlandLevel } from './src/levels/HighlandLevel.js';
BootstrapGame({
    modules: [HighlandModule],
    configPath: new URL('./config/game.config.json', import.meta.url).href,
    manifestPath: new URL('./config/resources.json', import.meta.url).href,
    levels: [
        new HighlandLevel('hearthvale'),
        new HighlandLevel('mistfell'),
        new HighlandLevel('ashen-ridge'),
        new HighlandLevel('highland-citadel'),
        new HighlandLevel('sunlit-meadow'),
        new HighlandLevel('whispering-woods'),
        new HighlandLevel('sunken-ruins'),
        new HighlandLevel('battlefield'),
    ],
});
