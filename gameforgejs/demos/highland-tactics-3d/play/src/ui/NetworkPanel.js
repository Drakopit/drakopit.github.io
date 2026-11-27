import { Rectangle, TextBox } from 'gameforgejs/2d';
import { DefaultServerUrl, NetworkConfig, NetworkModes } from '../net/MmoClient.js';
import { PasswordBox } from './PasswordBox.js';

/** Title-screen rows of the network form, relative to the panel top. */
export function NetworkFormLayout(x, y, width) {
    const inner = width - 48, half = (width - 38) / 2;
    return {
        modes: NetworkModes.map((mode, index) => ({ mode, x: x + 16 + index * ((width - 32 - 12) / 3 + 6), y: y + 72, width: (width - 32 - 12) / 3, height: 24 })),
        address: { x: x + 24, y: y + 112, width: inner, height: 32 },
        username: { x: x + 24, y: y + 152, width: inner, height: 32 },
        password: { x: x + 24, y: y + 192, width: inner, height: 32 },
        login: { x: x + 16, y: y + 238, width: half, height: 44 },
        register: { x: x + 22 + half, y: y + 238, width: half, height: 44 },
    };
}

/**
 * OFFLINE / LAN / ONLINE on the title screen, the server address, username and (masked)
 * password, and LOGIN / REGISTER. Offline keeps the original local-save flow.
 */
export class NetworkPanel {
    constructor(hud) {
        this.hud = hud;
        const level = hud.level;
        this.network = NetworkConfig(level.context?.config);
        this.mode = this.network.mode;
        this.memory = level.NetworkMemory?.() ?? {};
        this.modeButtons = NetworkModes.map(mode => hud.Button(mode.toUpperCase(), () => this.SetMode(mode)));
        this.address = new TextBox(hud.screen);
        this.address.SetPlaceholder('Server address (ws://host:7878/mmo)');
        this.address.SetMaxLength(120);
        this.username = new TextBox(hud.screen);
        this.username.SetPlaceholder('Username');
        this.username.SetMaxLength(16);
        this.password = new PasswordBox(hud.screen);
        this.password.SetPlaceholder('Password (8+ characters)');
        this.password.SetMaxLength(128);
        this.login = hud.Button('LOGIN', () => this.Submit(false));
        this.register = hud.Button('REGISTER', () => this.Submit(true));
        this.signOut = hud.Button('SIGN OUT', () => level.SignOut());
        this.fields = [this.address, this.username, this.password];
        this.address.onSubmit = () => this.Focus(this.username);
        this.username.onSubmit = () => this.Focus(this.password);
        this.password.onSubmit = () => this.Submit(false);
        this.SetMode(this.mode);
    }

    SetMode(mode) {
        if (!NetworkModes.includes(mode) || this.hud.level.signedIn) return;
        this.mode = mode;
        const remembered = this.memory[mode] ?? {};
        this.address.SetText(remembered.address ?? DefaultServerUrl(mode, this.network));
        if (remembered.username && !this.username.GetText()) this.username.SetText(remembered.username);
        for (const field of this.fields) field.SetActive(false);
    }

    /** The form is shown while a network mode is chosen and nobody is signed in yet. */
    get FormVisible() {
        return this.mode !== 'offline' && !this.hud.level.signedIn;
    }

    Focus(field) {
        for (const other of [...this.fields, this.hud.nameField]) other.SetActive(other === field);
    }

    Submit(register) {
        for (const field of this.fields) field.SetActive(false);
        const level = this.hud.level;
        return level.SignIn({
            mode: this.mode,
            address: this.address.GetText(),
            username: this.username.GetText().trim(),
            password: this.password.GetText(),
            register,
        }).then(ok => { if (ok) this.password.SetText(''); return ok; });
    }

    /** Clicks on the fields (only the visible ones have a real box). */
    Click() {
        let hit = false;
        for (const field of this.fields) hit = field.Click() || hit;
        return hit;
    }

    ActiveField() {
        return this.fields.find(field => field.isActive) ?? null;
    }

    /** Keyboard for the form: typing, Backspace, Enter (next field / submit) and Tab. */
    HandleInput(event) {
        const field = this.ActiveField();
        if (!field) return false;
        if (event.key === 'Tab') {
            const next = this.fields[(this.fields.indexOf(field) + (event.shiftKey ? 2 : 1)) % this.fields.length];
            this.Focus(next);
        }
        else if (event.key === 'Enter') field.onSubmit?.();
        else if (event.key === 'Escape') field.SetActive(false);
        else if (event.key === 'Backspace' || (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey)) field.HandleInput(event);
        else return false;
        event.preventDefault?.();
        return true;
    }

    Hide() {
        for (const field of this.fields) field.SetBox(new Rectangle(-1000, -1000, 0, 0));
    }

    /** The mode row, always shown on the title screen (locked once signed in). */
    DrawModes(layout) {
        const signedIn = this.hud.level.signedIn;
        layout.modes.forEach((slot, index) => this.hud.Place(this.modeButtons[index], slot.x, slot.y, slot.width, slot.height, !signedIn || slot.mode === this.mode, slot.mode === this.mode));
    }

    /** Address, username, password and the two buttons. */
    DrawForm(layout) {
        const { frame: f } = this.hud;
        const busy = this.hud.level.networkBusy;
        for (const [field, rect, label] of [[this.address, layout.address, 'SERVER'], [this.username, layout.username, 'USER'], [this.password, layout.password, 'PASSWORD']]) {
            field.SetBox(new Rectangle(rect.x + 64, rect.y, rect.width - 64, rect.height));
            field.DrawCursor();
            f.Text(label, rect.x, rect.y + rect.height * 0.62, { size: 9, weight: 700, color: f.theme.muted, maxWidth: 60 });
        }
        this.hud.Place(this.login, layout.login.x, layout.login.y, layout.login.width, layout.login.height, !busy);
        this.hud.Place(this.register, layout.register.x, layout.register.y, layout.register.width, layout.register.height, !busy);
    }

    Dispose() {
        for (const field of this.fields) field.Dispose();
    }
}
