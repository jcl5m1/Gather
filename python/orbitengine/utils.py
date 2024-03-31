import time
import types
import hashlib
import numpy as np
import time
import functools
import os
import pickle
import json
from astropy.units import Quantity
import inspect
import builtins
import pprint
from scipy.optimize import minimize
EPSILON = 1e-6

CACHE_DIR = "cache"

def print(*args, **kwargs):
    # Get the previous frame in the stack, otherwise it would be this function
    frame = inspect.currentframe().f_back
    # Get the file name and line number of the previous frame
    file_name = os.path.basename(frame.f_code.co_filename)
    line_number = frame.f_lineno
    # Call the original print function with the file name and line number
    builtins.print(f"{file_name}:{line_number} ", *args, **kwargs)

def pprint(*args, **kwargs):
    # Get the previous frame in the stack, otherwise it would be this function
    frame = inspect.currentframe().f_back
    # Get the file name and line number of the previous frame
    file_name = os.path.basename(frame.f_code.co_filename)
    line_number = frame.f_lineno
    # Call the original print function with the file name and line number
    builtins.print(f"{file_name}:{line_number}:")
    pprint.pprint(*args, **kwargs)

def formatTime(time):
    if time > 1000*u.year:
        return f"{time.to(u.year):.2e}"
    if time > 1*u.year:
        return f"{time.to(u.year):.2f}"
    if time > 1*u.day:
        return f"{time.to(u.day):.2f}"
    if time > 1*u.hour:
        return f"{time.to(u.hour):.2f}"
    if time > 1*u.min:
        return f"{time.to(u.min):.2f}"
    return f"{time.to(u.s):.2f}"

def formatDistance(distance):
    if distance > 9.461e+12*u.km:
        return f"{distance.to(u.km).value/9.461e+12:.2f} Lyr"
    elif distance > 1.079e+9*u.km:
        return f"{distance.to(u.km).value/1.079e+97:.2f} Lhr"
    elif distance > 299792*u.km:
        return f"{distance.to(u.km).value/299792:.2f} Ls"
    elif distance > 1000*u.km:
        return f"{distance.to(u.Mm):.2f}"
    elif distance > 1*u.km:
        return f"{distance.to(u.km):.2f}"
    else:
        return f"{distance.to(u.m):.2f}"

def formatVelocity(velocity):
    if velocity > 1000*u.km/u.s:
        return f"{velocity.to(u.Mm/u.s):.2f}"
    elif velocity > 1*u.km/u.s:
        return f"{velocity.to(u.km/u.s):.2f}"
    else:
        return f"{velocity.to(u.m/u.s):.2f}"

def formatAcceleration(acceleration):
    if acceleration > 1000*u.km/u.s**2:
        return f"{acceleration.to(u.Mm/u.s**2):.2f}"
    elif acceleration > 1*u.km/u.s:
        return f"{acceleration.to(u.km/u.s**2):.2f}"
    else:
        return f"{acceleration.to(u.m/u.s**2):.2f}"


def time_it(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        start = time.time()
        result = func(*args, **kwargs)
        end = time.time()
        print(f"{func.__name__} took {end-start:.4f} seconds")
        return result
    return wrapper

def to_dict_recursive(item):
    """Recursively converts objects with a 'to_dict' method to dictionaries."""
    if isinstance(item, list):
        return [to_dict_recursive(subitem) for subitem in item]
    elif isinstance(item, dict):
        return {key: to_dict_recursive(value) for key, value in item.items()}
    elif isinstance(item, tuple):  # Handle tuples
        return list(to_dict_recursive(subitem) for subitem in item)
    elif isinstance(item, Quantity):
            return {"value": item.value.tolist(), "unit": item.unit.to_string()}
    elif isinstance(item, np.ndarray):
        return item.tolist()
    elif isinstance(item, np.dtype):
        return str(item)
    elif isinstance(item, types.MethodType):
        return item.__qualname__
    elif isinstance(item, object) and hasattr(item, '__dict__'):
        return to_dict_recursive(item.__dict__)
    else:
        return item


def get_source_recursive(obj):
    try:
        source_lines = inspect.getsourcelines(obj)[0]  # Get source lines and metadata
    except (IOError, OSError):  # Source code might not be accessible
        return None

    # Strip leading indentation and trailing newline from the source lines
    source_code = "".join(line.rstrip() for line in source_lines)

    # Recursively fetch source of  nested functions
    nested_functions = inspect.getmembers(obj, inspect.isfunction)
    for _, nested_fn in nested_functions:
        nested_source = get_source_recursive(nested_fn)
        if nested_source:
            source_code += "\n" + nested_source  # Add nested function's source

    return source_code


def cache(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        dir=CACHE_DIR

        code_str = get_source_recursive(func)
        hasher = hashlib.md5()
        hasher.update(code_str.encode())
        hasher.update(pickle.dumps(args))
        hasher.update(pickle.dumps(kwargs))
        hash = hasher.hexdigest()

        filename = os.path.join(dir, f"{func.__module__}{func.__name__}_{hash}.pkl")
        if os.path.exists(filename):
            with open(filename, 'rb') as fp:
                return pickle.load(fp)['result']
        result = func(*args, **kwargs)

        os.makedirs(dir,exist_ok=True)
        data = {
            '__module__':func.__module__,
            '__name__':func.__name__,
            'hash':hash,
            'result':result,
            'args':args,
            'kwargs':kwargs
        }
        with open(filename,'wb') as fp:
            pickle.dump(data, fp)
        return result
    return wrapper

@time_it
def minimize_cached(func, x, cache_tol=EPSILON, **kwargs):
    # create a unique filename from source code, and parameters
    hasher = hashlib.md5()
    code_str = get_source_recursive(func)
    hasher.update(code_str.encode())
    hasher.update(pickle.dumps(kwargs))
    hash = hasher.hexdigest()
    dir = CACHE_DIR
    filename = os.path.join(dir, f"{func.__module__}{func.__name__}_{hash}.pkl")
    x0 = x
    #load the guess from cache
    if os.path.exists(filename):
        with open(filename, 'rb') as fp:
            res = pickle.load(fp)['res']
            return res

    # compute minimization
    res = minimize(func, x0, **kwargs)

    # save the guess to cache only if 
    # minimization converged to 0 and wasn't already cached
    if res.fun < cache_tol:
        os.makedirs(dir,exist_ok=True)
        data = {
            '__module__':func.__module__,
            '__name__':func.__name__,
            'hash':hash,
            'kwargs':kwargs,
            'res': res
        }
        with open(filename, 'wb') as fp:
            pickle.dump(data, fp)
            print(f"Cached result: {filename}")

    return res

def spherical_to_cartesian(rtp):
    x = rtp[0] * np.sin(rtp[1]) * np.cos(rtp[2])
    y = rtp[0] * np.sin(rtp[1]) * np.sin(rtp[2])
    z = rtp[0] * np.cos(rtp[1])
    return np.array([x, y, z])

def cartesian_to_spherical(cart):
    r = np.linalg.norm(cart)
    theta = np.arccos(cart[2] / r)
    phi = np.arctan2(cart[1], cart[0])
    return np.array([r, theta, phi])

def line_sphere_intersection(P1, P2, C, r):
    # Compute the directional vector of the line
    d = P2 - P1

    # Compute the vector from the center of the sphere to P1
    f = P1 - C

    # Solve the quadratic equation
    a = np.dot(d, d)
    if a < EPSILON:
        return [(0,P1)]
    b = 2 * np.dot(f, d)
    c = np.dot(f, f) - r**2

    discriminant = b**2 - 4*a*c
    if discriminant < 0:
        # No intersection
        return []
    else:
        # Compute the two intersections
        t1 = (-b - np.sqrt(discriminant)) / (2*a)
        t2 = (-b + np.sqrt(discriminant)) / (2*a)

        # If the intersections are outside the line segment, discard them
        intersections = []
        if 0 <= t1 <= 1:
            intersections.append((t1, P1 + t1*d))
        if 0 <= t2 <= 1:
            intersections.append((t2, P1 + t2*d))

        return intersections
