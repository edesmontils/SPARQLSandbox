"""Apparence : zones de saisie plus grandes et plus lisibles."""

FEUILLE = """
QLineEdit, QSpinBox, QComboBox {
    font-size: 15px; min-height: 30px; padding: 1px 6px;
    border: 1px solid #9ca3af; border-radius: 5px; background: palette(base);
}
QSpinBox { min-width: 110px; padding-right: 18px; }
QLineEdit:focus, QSpinBox:focus, QPlainTextEdit:focus { border: 2px solid #2563eb; }
QPlainTextEdit { font-size: 15px; border: 1px solid #9ca3af; border-radius: 5px; }
QListWidget, QTableWidget { font-size: 14px; }
"""
