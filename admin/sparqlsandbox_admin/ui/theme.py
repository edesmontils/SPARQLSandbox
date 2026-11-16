"""Thème : couleurs, typographie et feuille de style de l'application.

Les couleurs viennent de l'icône (sarcelle et indigo du graphe RDF, ambre du nœud « littéral »).
L'ambre est réservé à un seul usage : signaler la production.
"""
from __future__ import annotations

from PySide6.QtGui import QFont, QFontDatabase

# --- jetons
ENCRE = "#20265a"        # indigo : plaque de machine, titres
SARCELLE = "#1f8a8c"     # action principale, sélection, focus
SARCELLE_FONCE = "#17696b"
SARCELLE_PALE = "#e3f2f2"
PAPIER = "#f5f6fa"       # fond de fenêtre
SURFACE = "#ffffff"      # champs et zones de saisie
TRAIT = "#dfe3ee"
TEXTE = "#1c2033"
ATTENUE = "#5d6482"
AMBRE = "#f2b53b"        # production
AMBRE_PALE = "#fff4d6"
AMBRE_TEXTE = "#6b4a00"
DANGER = "#b3261e"
DANGER_PALE = "#fdecea"
OK = "#1b7f4b"

MONO = "Menlo"


def police_interface() -> QFont:
    f = QFont(QFontDatabase.systemFont(QFontDatabase.GeneralFont))
    f.setPixelSize(14)
    return f


def police_code() -> QFont:
    f = QFont(MONO)
    f.setStyleHint(QFont.Monospace)
    f.setPixelSize(13)
    return f


FEUILLE = f"""
* {{ color: {TEXTE}; }}
QMainWindow, QDialog {{ background: {PAPIER}; }}
QWidget#contenu {{ background: {PAPIER}; }}
QToolTip {{ background: {ENCRE}; color: white; border: 0; padding: 4px 8px; }}

/* titres et textes */
QLabel#titrePage {{ font-size: 24px; font-weight: 600; color: {ENCRE}; }}
QLabel#sousTitre, QLabel[role="aide"] {{ color: {ATTENUE}; font-size: 13px; }}
QLabel[role="section"] {{ font-size: 15px; font-weight: 600; color: {ENCRE}; }}
QLabel[role="champ"] {{ font-size: 14px; font-weight: 600; }}
QLabel[role="code"] {{ font-family: {MONO}; font-size: 13px; }}

/* champs de saisie */
QLineEdit, QSpinBox, QPlainTextEdit, QTextBrowser, QListWidget, QTableWidget {{
    background: {SURFACE}; border: 1px solid {TRAIT}; border-radius: 6px;
    selection-background-color: {SARCELLE}; selection-color: white;
}}
QLineEdit, QSpinBox {{ font-size: 14px; min-height: 32px; padding: 0 8px; }}
QSpinBox {{ padding-right: 4px; }}
QPlainTextEdit {{ font-size: 14px; padding: 4px 6px; }}
QLineEdit:focus, QSpinBox:focus, QPlainTextEdit:focus {{ border: 2px solid {SARCELLE}; }}
QLineEdit[role="titre"] {{ font-size: 22px; font-weight: 600; color: {ENCRE}; min-height: 40px;
    background: transparent; border: 1px solid transparent; padding: 0 6px; margin-left: -7px; }}
QLineEdit[role="titre"]:hover {{ border: 1px solid {TRAIT}; background: {SURFACE}; }}
QLineEdit[role="titre"]:focus {{ border: 2px solid {SARCELLE}; background: {SURFACE}; }}
QLineEdit[role="code"], QPlainTextEdit[role="code"] {{ font-family: {MONO}; font-size: 13px; }}
QListWidget, QTableWidget {{ outline: 0; }}
QListWidget::item:selected, QTableWidget::item:selected {{ background: {SARCELLE_PALE}; color: {TEXTE}; }}
QListWidget::item {{ padding: 2px; }}
QHeaderView::section {{ background: {PAPIER}; border: 0; border-bottom: 1px solid {TRAIT};
    padding: 6px 8px; font-weight: 600; color: {ATTENUE}; }}
QTableWidget {{ gridline-color: transparent; }}
QTableWidget::item {{ padding: 4px 8px; border-bottom: 1px solid {PAPIER}; }}
QScrollBar:vertical {{ width: 10px; background: transparent; margin: 2px; }}
QScrollBar::handle:vertical {{ background: {TRAIT}; border-radius: 4px; min-height: 30px; }}
QScrollBar::add-line, QScrollBar::sub-line {{ height: 0; width: 0; }}
QScrollBar:horizontal {{ height: 10px; background: transparent; margin: 2px; }}
QScrollBar::handle:horizontal {{ background: {TRAIT}; border-radius: 4px; min-width: 30px; }}

/* boutons */
QPushButton {{ font-size: 14px; min-height: 32px; padding: 0 14px; border-radius: 6px;
    background: {SURFACE}; border: 1px solid #c9cfe0; }}
QPushButton:hover {{ background: {PAPIER}; border-color: {ATTENUE}; }}
QPushButton:disabled {{ color: #a3a9c0; background: {PAPIER}; border-color: {TRAIT}; }}
QPushButton:focus {{ border: 2px solid {SARCELLE}; }}
QPushButton[role="primaire"] {{ background: {SARCELLE}; border: 1px solid {SARCELLE}; color: white;
    font-weight: 600; }}
QPushButton[role="primaire"]:hover {{ background: {SARCELLE_FONCE}; border-color: {SARCELLE_FONCE}; }}
QPushButton[role="primaire"]:disabled {{ background: #9fcfd0; border-color: #9fcfd0; color: white; }}
QPushButton[role="danger"] {{ color: {DANGER}; border-color: #e3b5b1; }}
QPushButton[role="danger"]:hover {{ background: {DANGER_PALE}; border-color: {DANGER}; }}
QPushButton[role="lien"] {{ border: 0; background: transparent; color: {SARCELLE_FONCE};
    padding: 0 4px; min-height: 24px; text-decoration: underline; }}
QPushButton[role="lien"]:hover {{ color: {ENCRE}; background: transparent; }}
QPushButton::menu-indicator {{ image: none; width: 0; }}

/* navigation latérale */
QWidget#lateral {{ background: {PAPIER}; border-right: 1px solid {TRAIT}; }}
QPushButton[nav="true"] {{ text-align: left; border: 0; border-left: 3px solid transparent;
    border-radius: 0; padding: 0 16px; min-height: 38px; background: transparent; font-size: 14px; }}
QPushButton[nav="true"]:hover {{ background: #eceef6; }}
QPushButton[nav="true"]:checked {{ border-left: 3px solid {SARCELLE}; background: {SURFACE};
    color: {SARCELLE_FONCE}; font-weight: 600; }}
QLabel[role="groupe"] {{ color: {ATTENUE}; font-size: 12px; padding: 14px 19px 4px 19px; }}

/* plaque de machine : l'élément le plus visible de la fenêtre */
QPushButton#plaque {{ text-align: left; background: {ENCRE}; border: 0; border-radius: 10px;
    padding: 10px 12px; min-height: 52px; color: white; font-size: 17px; font-weight: 600; }}
QPushButton#plaque:hover {{ background: #2c3478; }}
QPushButton#plaque[production="true"] {{ background: {AMBRE}; color: #3a2800; }}
QPushButton#plaque[production="true"]:hover {{ background: #f7c352; }}

QPushButton#plaque QLabel {{ background: transparent; color: white; }}
QLabel#plaqueNom {{ font-size: 17px; font-weight: 600; }}
QLabel#plaqueDetail {{ font-size: 12px; color: #c4c9ee; }}
QPushButton#plaque[production="true"] QLabel {{ color: #3a2800; }}
QPushButton#plaque[production="true"] QLabel#plaqueDetail {{ color: #6b4a00; }}

/* onglets internes */
QTabBar {{ background: transparent; }}
QTabBar::tab {{ font-size: 14px; padding: 8px 4px; margin-right: 22px; border: 0;
    border-bottom: 3px solid transparent; color: {ATTENUE}; }}
QTabBar::tab:selected {{ color: {ENCRE}; font-weight: 600; border-bottom: 3px solid {SARCELLE}; }}
QTabBar::tab:hover:!selected {{ color: {TEXTE}; }}
QTabWidget::pane {{ border: 0; border-top: 1px solid {TRAIT}; top: -1px; }}

/* bandeaux */
QFrame#bandeauProd {{ background: {AMBRE_PALE}; border: 0; border-bottom: 1px solid {AMBRE}; }}
QFrame#bandeauProd QLabel {{ color: {AMBRE_TEXTE}; font-size: 13px; }}
QFrame#barreModifs {{ background: {SURFACE}; border-top: 1px solid {TRAIT}; }}
QLabel#etatModifs {{ color: {AMBRE_TEXTE}; font-weight: 600; }}
QProgressBar {{ border: 0; background: transparent; max-height: 3px; min-height: 3px; }}
QProgressBar::chunk {{ background: {SARCELLE}; }}
QLabel#toast {{ background: {ENCRE}; color: white; border-radius: 8px; padding: 10px 16px; font-size: 14px; }}
QLabel#toast[erreur="true"] {{ background: {DANGER}; }}
QFrame#zoneDepot {{ border: 2px dashed {TRAIT}; border-radius: 8px; }}
QFrame#zoneDepot[survol="true"] {{ border-color: {SARCELLE}; background: {SARCELLE_PALE}; }}
QFrame#ligne {{ background: {SURFACE}; border: 1px solid {TRAIT}; border-radius: 6px; }}
QMenu {{ background: {SURFACE}; border: 1px solid {TRAIT}; padding: 4px; }}
QMenu::item {{ padding: 7px 18px; border-radius: 4px; }}
QMenu::item:selected {{ background: {SARCELLE_PALE}; color: {TEXTE}; }}
QMenu::separator {{ height: 1px; background: {TRAIT}; margin: 4px 6px; }}
QCheckBox {{ spacing: 8px; font-size: 14px; }}
QMessageBox QLabel {{ font-size: 14px; }}
"""
