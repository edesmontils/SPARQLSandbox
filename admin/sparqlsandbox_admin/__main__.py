import sys

from PySide6.QtWidgets import QApplication

from .ui.fenetre import Fenetre


def main() -> int:
    app = QApplication(sys.argv)
    app.setApplicationName("SPARQLSandbox Admin")
    fenetre = Fenetre()
    fenetre.show()
    return app.exec()


if __name__ == "__main__":
    sys.exit(main())
