"""A calculator built with the pyterm helper module.

Type an expression (2 * (3 + 4), sqrt(2), x = 5, x ** 2) or a command:
vars, history, clear, help, exit.
"""
import ast
import math
import operator

import pyterm
from pyterm import style

app = pyterm.App("calc", intro=style("Calculator", bold=True)
                 + " — type an expression like " + style("2 * (3 + 4)", "cyan")
                 + ", or " + style("help", "cyan") + ".")

OPS = {
    ast.Add: operator.add, ast.Sub: operator.sub, ast.Mult: operator.mul,
    ast.Div: operator.truediv, ast.FloorDiv: operator.floordiv, ast.Mod: operator.mod,
    ast.Pow: operator.pow, ast.USub: operator.neg, ast.UAdd: operator.pos,
}
FUNCS = {name: getattr(math, name) for name in (
    "sqrt", "sin", "cos", "tan", "asin", "acos", "atan", "log", "log10", "log2", "exp",
    "floor", "ceil", "factorial", "degrees", "radians", "hypot", "gcd")}
FUNCS.update(abs=abs, round=round, min=min, max=max)
variables = {"pi": math.pi, "e": math.e, "tau": math.tau}
results = []


def evaluate(node):
    if isinstance(node, ast.Expression):
        return evaluate(node.body)
    if isinstance(node, ast.Constant) and isinstance(node.value, (int, float)):
        return node.value
    if isinstance(node, ast.BinOp) and type(node.op) in OPS:
        left, right = evaluate(node.left), evaluate(node.right)
        if isinstance(node.op, ast.Pow) and abs(right) > 10000:
            raise ValueError("exponent too large")
        return OPS[type(node.op)](left, right)
    if isinstance(node, ast.UnaryOp) and type(node.op) in OPS:
        return OPS[type(node.op)](evaluate(node.operand))
    if isinstance(node, ast.Name):
        if node.id in variables:
            return variables[node.id]
        raise NameError(f"unknown name {node.id!r}")
    if isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in FUNCS:
        return FUNCS[node.func.id](*[evaluate(a) for a in node.args])
    raise ValueError("only numbers, + - * / // % **, variables and maths functions are allowed")


@app.default
def calculate(line):
    target = None
    if "=" in line and "==" not in line:
        target, line = (p.strip() for p in line.split("=", 1))
        if not target.isidentifier() or target in FUNCS:
            print(style(f"Can't use {target!r} as a variable name.", "yellow"))
            return
    try:
        value = evaluate(ast.parse(line, mode="eval"))
    except ZeroDivisionError:
        print(style("Can't divide by zero.", "red"))
        return
    except (SyntaxError, ValueError, NameError, TypeError, OverflowError) as e:
        print(style(str(e) if not isinstance(e, SyntaxError) else "That isn't a valid expression.", "red"))
        return
    if isinstance(value, float) and value.is_integer() and abs(value) < 1e15:
        value = int(value)
    variables["ans"] = value
    if target:
        variables[target] = value
    results.append((line, value))
    print(style("=", "grey"), style(f"{value}", "green", bold=True))


@app.command
def vars():
    "Show the variables you have defined"
    pyterm.table([[style(k, "cyan"), v] for k, v in sorted(variables.items())], headers=["name", "value"])


@app.command
def history():
    "Show earlier results"
    if not results:
        print(style("Nothing calculated yet.", "grey"))
    for expr, value in results[-20:]:
        print(f"  {expr} {style('=', 'grey')} {value}")


@app.command
def functions():
    "List the maths functions you can use"
    print(", ".join(sorted(FUNCS)))


if __name__ == "__main__":
    app.run()
