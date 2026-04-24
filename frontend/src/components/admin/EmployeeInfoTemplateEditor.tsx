import { useRef, useState, useEffect } from 'react';
import ReactQuill from 'react-quill';
import 'react-quill/dist/quill.snow.css';
import { FileText, Save } from 'lucide-react';

const QUILL_MODULES = {
  toolbar: [
    [{ header: [1, 2, 3, false] }],
    ['bold', 'italic', 'underline'],
    [{ list: 'ordered' }, { list: 'bullet' }],
    ['blockquote'],
    ['clean'],
  ],
};

const QUILL_FORMATS = [
  'header',
  'bold', 'italic', 'underline',
  'list', 'bullet',
  'blockquote',
];

const VARIABLES: Array<{ key: string; label: string }> = [
  { key: 'firstName', label: 'Vorname' },
  { key: 'lastName', label: 'Nachname' },
  { key: 'fullName', label: 'Voller Name' },
  { key: 'employeeNumber', label: 'MA-Nummer' },
  { key: 'rfidCard', label: 'Kartennummer' },
  { key: 'email', label: 'E-Mail' },
  { key: 'phone', label: 'Telefon' },
  { key: 'workCategory', label: 'Arbeitskategorie' },
  { key: 'earliestClockIn', label: 'Frühester Arbeitsbeginn' },
  { key: 'defaultClockOut', label: 'Reguläres Arbeitsende' },
  { key: 'weeklyHours', label: 'Wochenstunden' },
  { key: 'vacationDaysPerYear', label: 'Urlaubstage/Jahr' },
  { key: 'workDays', label: 'Arbeitstage' },
  { key: 'startDate', label: 'Eintrittsdatum' },
  { key: 'today', label: 'Heutiges Datum' },
  { key: 'companyName', label: 'Firmenname' },
  { key: 'companyAddress', label: 'Firmenadresse' },
  { key: 'companyPhone', label: 'Firmentelefon' },
  { key: 'companyEmail', label: 'Firmen-E-Mail' },
];

export const DEFAULT_TEMPLATE = `<h1>Info-Sheet und Arbeitsanweisung zur Einführung der neuen digitalen Zeiterfassung</h1>
<p>Liebe/r {{firstName}} {{lastName}},</p>
<p>wir modernisieren unsere bestehende digitale Zeiterfassung, da das bisherige System in die Jahre gekommen ist. Ab dem 01.04.2026 wird dieses durch eine neue, zeitgemäße Lösung ersetzt.</p>
<h2>Was ändert sich?</h2>
<ul>
  <li>Das bisherige System wird vollständig durch ein neues System ersetzt.</li>
  <li>Arbeitszeiten werden künftig über das Stempel-Terminal im EG neben dem Eingang bzw. im OG im Büro erfasst.</li>
  <li>Jeder Mitarbeitende erhält einen persönlichen Zugang zu seinem Zeitkonto.</li>
</ul>
<h2>Ihre Vorteile</h2>
<ul>
  <li>Modernes und benutzerfreundliches System</li>
  <li>Transparente und nachvollziehbare Arbeitszeiten</li>
  <li>Schnellere und genauere Abrechnung</li>
</ul>
<h2>Was ist zu beachten?</h2>
<ul>
  <li>Bitte erfassen Sie <strong>Arbeitsbeginn, Pausen und Arbeitsende</strong> korrekt.</li>
  <li>Ihr Zugang zum Zeitkonto ist <strong>passwortgeschützt</strong> und streng vertraulich zu behandeln.</li>
  <li>Eine Weitergabe von Zugangsdaten an Dritte ist <strong>nicht gestattet</strong>.</li>
  <li>Es ist <strong>nicht erlaubt</strong>, Arbeitszeiten für Kolleginnen oder Kollegen zu erfassen.</li>
  <li>Erfolgt keine Ausstempelung, wird automatisch eine <strong>Ausstempelung um 24:00 Uhr</strong> vorgenommen.</li>
  <li>In diesem Fall sind Sie verpflichtet, Ihre korrekte Arbeitszeit eigenständig über das Online-Tool nachzumelden.</li>
</ul>
<h3>Mitarbeiterdaten</h3>
<p><strong>Name:</strong> {{fullName}}</p>
<p><strong>Arbeitskategorie:</strong> {{workCategory}}</p>
<p><strong>Frühestmöglicher Arbeitsbeginn:</strong> {{earliestClockIn}}</p>
<p><strong>Reguläres Arbeitsende:</strong> {{defaultClockOut}}</p>
<p><strong>Kartennummer:</strong> {{rfidCard}}</p>
<h3>Empfangsbestätigung</h3>
<p>Hiermit bestätige ich den Erhalt meiner persönlichen Zugangsdaten zum Zeitkonto sowie die Informationen zur neuen digitalen Zeiterfassung.</p>
<p><strong>Datum:</strong> {{today}}</p>
<p><strong>Unterschrift:</strong> ______________________________</p>
<p>Vielen Dank für Ihre Unterstützung bei der Umstellung!</p>
<p>{{companyName}}</p>`;

interface Props {
  value: string;
  onSave: (html: string) => void;
  saving: boolean;
}

export default function EmployeeInfoTemplateEditor({ value, onSave, saving }: Props) {
  const quillRef = useRef<ReactQuill | null>(null);
  const [html, setHtml] = useState(value || DEFAULT_TEMPLATE);

  useEffect(() => {
    if (value && value.trim() !== '') setHtml(value);
  }, [value]);

  const insertVariable = (key: string) => {
    const quill = quillRef.current?.getEditor();
    if (!quill) return;
    const range = quill.getSelection(true);
    const insertAt = range ? range.index : quill.getLength();
    quill.insertText(insertAt, `{{${key}}}`, 'user');
    quill.setSelection(insertAt + key.length + 4, 0, 'user');
  };

  const resetToDefault = () => {
    setHtml(DEFAULT_TEMPLATE);
  };

  return (
    <div className="card">
      <div className="p-6 border-b border-gray-100">
        <h2 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
          <FileText size={20} />
          Info-Schreiben-Vorlage
        </h2>
        <p className="text-sm text-gray-500 mt-1">
          Diese Vorlage wird für das Info-Schreiben neuer Mitarbeiter genutzt. Platzhalter in doppelten
          geschweiften Klammern (z.B. <code className="text-xs bg-gray-100 rounded px-1">{'{{firstName}}'}</code>)
          werden beim Generieren automatisch ersetzt.
        </p>
      </div>
      <div className="p-6 grid grid-cols-1 lg:grid-cols-[1fr,220px] gap-4">
        <div>
          <ReactQuill
            ref={quillRef}
            theme="snow"
            value={html}
            onChange={setHtml}
            modules={QUILL_MODULES}
            formats={QUILL_FORMATS}
            className="bg-white"
            style={{ minHeight: '400px' }}
          />
        </div>
        <div className="space-y-2">
          <p className="text-xs font-semibold text-gray-700 uppercase tracking-wide">Variablen einfügen</p>
          <div className="flex flex-col gap-1 max-h-[500px] overflow-y-auto pr-1">
            {VARIABLES.map((v) => (
              <button
                key={v.key}
                type="button"
                onClick={() => insertVariable(v.key)}
                className="text-left text-xs px-3 py-2 rounded-md bg-gray-50 hover:bg-primary-50 hover:text-primary-700 border border-gray-200 transition-colors"
                title={`Fügt {{${v.key}}} ein`}
              >
                <div className="font-medium">{v.label}</div>
                <code className="text-[10px] text-gray-500">{`{{${v.key}}}`}</code>
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="p-6 border-t border-gray-100 flex justify-between items-center">
        <button
          type="button"
          onClick={resetToDefault}
          className="text-sm text-gray-500 hover:text-gray-700"
        >
          Auf Standardvorlage zurücksetzen
        </button>
        <button
          type="button"
          onClick={() => onSave(html)}
          disabled={saving}
          className="btn btn-primary flex items-center gap-2"
        >
          <Save size={18} />
          {saving ? 'Speichern…' : 'Vorlage speichern'}
        </button>
      </div>
    </div>
  );
}
