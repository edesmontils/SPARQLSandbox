import sys

from PySide6.QtWidgets import QApplication

from .ui import theme
from .ui.fenetre import Fenetre


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("SPARQLSandbox Admin")
    app.setFont(theme.police_interface())
    app.setStyleSheet(theme.FEUILLE)
    fenetre = Fenetre()
    fenetre.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
