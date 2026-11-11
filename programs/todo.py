"""A to-do list manager built on the standard library's cmd.Cmd.

Tasks are saved in ~/browser/todo.json, the folder PyTerm keeps in your
browser, so they are still there after you reload the page.
"""
import cmd
import json
import os
from datetime import date

import pyterm
from pyterm import style

STORE = os.path.join(pyterm.BROWSER_DIR, "todo.json")


def load():
    try:
        with open(STORE) as fh:
            return json.load(fh)
    except (OSError, ValueError):
        return []


def save(tasks):
    os.makedirs(os.path.dirname(STORE), exist_ok=True)
    with open(STORE, "w") as fh:
        json.dump(tasks, fh, indent=2)


class Todo(cmd.Cmd):
    intro = (style("To-do list", bold=True) + " — type " + style("help", "cyan")
             + " for commands, " + style("exit", "cyan") + " to leave.")
    prompt = style("todo> ", "green", bold=True)

    def preloop(self):
        self.tasks = load()
        pyterm.title("To-do list")
        self.do_list("")

    def postloop(self):
        print(style("Bye! Your tasks are saved.", "grey"))

    def emptyline(self):
        pass

    def default(self, line):
        print(style(f"Unknown command: {line.split()[0]}. Type help.", "yellow"))

    def _index(self, arg):
        try:
            i = int(arg) - 1
            if 0 <= i < len(self.tasks):
                return i
        except ValueError:
            pass
        print(style("Give the task number shown by list.", "yellow"))
        return None

    def do_add(self, arg):
        """add <text>  —  add a new task"""
        if not arg.strip():
            print(style("What should the task say?", "yellow"))
            return
        self.tasks.append({"text": arg.strip(), "done": False, "added": date.today().isoformat()})
        save(self.tasks)
        print(style("Added", "green"), f"#{len(self.tasks)}")

    def do_list(self, arg):
        """list  —  show all tasks"""
        if not self.tasks:
            print(style("No tasks yet. Add one with: add buy milk", "grey"))
            return
        rows = []
        for i, t in enumerate(self.tasks, 1):
            mark = style("✔", "green") if t["done"] else style("○", "grey")
            text = style(t["text"], dim=True) if t["done"] else t["text"]
            rows.append([style(str(i), "cyan"), mark, text, style(t.get("added", ""), "grey")])
        pyterm.table(rows)
        left = sum(not t["done"] for t in self.tasks)
        print(style(f"{left} open, {len(self.tasks) - left} done", "grey"))

    def do_done(self, arg):
        """done <n>  —  mark task n as done"""
        i = self._index(arg)
        if i is not None:
            self.tasks[i]["done"] = True
            save(self.tasks)
            print(style("Nice work!", "green"))

    def do_undo(self, arg):
        """undo <n>  —  mark task n as not done"""
        i = self._index(arg)
        if i is not None:
            self.tasks[i]["done"] = False
            save(self.tasks)

    def do_remove(self, arg):
        """remove <n>  —  delete task n"""
        i = self._index(arg)
        if i is not None and pyterm.confirm(f"Delete “{self.tasks[i]['text']}”?"):
            self.tasks.pop(i)
            save(self.tasks)
            print("Deleted.")

    def do_clean(self, arg):
        """clean  —  delete every finished task"""
        before = len(self.tasks)
        self.tasks = [t for t in self.tasks if not t["done"]]
        save(self.tasks)
        print(f"Removed {before - len(self.tasks)} finished task(s).")

    def do_export(self, arg):
        """export  —  download your tasks as todo.json"""
        save(self.tasks)
        pyterm.download(STORE)

    def do_clear(self, arg):
        """clear  —  clear the screen"""
        pyterm.clear()

    def do_exit(self, arg):
        """exit  —  leave the program"""
        return True

    do_quit = do_exit
    do_EOF = do_exit


if __name__ == "__main__":
    Todo().cmdloop()
