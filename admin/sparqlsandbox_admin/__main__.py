import sys

from PySide6.QtWidgets import QApplication

from .ui.fenetre import Fenetre
from .ui.style import FEUILLE


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("SPARQLSandbox Admin")
    app.setStyleSheet(FEUILLE)
    fenetre = Fenetre()
    fenetre.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
