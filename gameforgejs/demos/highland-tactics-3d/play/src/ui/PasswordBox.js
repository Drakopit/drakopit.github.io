import { TextBox } from 'gameforgejs/2d';

/** A TextBox that draws bullets instead of its text (the text itself stays as typed). */
export class PasswordBox extends TextBox {
    DrawTextEntry(context) {
        const text = this.text;
        this.text = '•'.repeat(text.length);
        try { super.DrawTextEntry(context); }
        finally { this.text = text; }
    }
}
