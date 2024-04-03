import time
import types
import hashlib
import numpy as np
import time
import functools
import os
from astropy.units import Quantity
import astropy.units as u
import inspect
import builtins
import pprint

import faiss
import orbitengine.utils as util
import pandas as pd
import re

from astropy.units import Quantity


from scipy.optimize import minimize
EPSILON = 1e-6

CACHE_DIR = "cache"
CACHE_INDEX_FILENAME = 'index.faiss'
CACHE_DATA_FILENAME = 'data.pkl'

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

def tolist(item):
    if isinstance(item, list):
        return [tolist(subitem) for subitem in item]
    elif isinstance(item, dict):
        return [tolist(value) for key, value in item.items()]
    elif isinstance(item, tuple):  # Handle tuples
        return list(tolist(subitem) for subitem in item)
    elif isinstance(item, Quantity):
            return item.value.tolist()
    elif isinstance(item, np.ndarray):
        return item.tolist()
    elif isinstance(item, object) and hasattr(item, '__dict__'):
       return tolist(item.__dict__)
    elif isinstance(item, bool):
        return 1 if item else 0
    elif item is None:
        return 0
    else:
        return item

def flatten(lst):
    return [item for sublist in lst for item in flatten(sublist)] if isinstance(lst, list) else [lst]

def hash_code(code):
    code_alphanumeric = re.sub(r'\W+', '', code)
    code_hash = hashlib.sha256(code_alphanumeric.encode()).hexdigest()
    return code_hash



# def load_nearest_neighbor_index(extract_feature_func, func, file_suffix = '.pkl', rebuild=False):
#     path = os.path.join(util.CACHE_DIR, func.__module__, func.__name__)
#     file_list = os.listdir(path)
#     index_filename = 'index.faiss'
#     index_prefix = index_filename.split('.')[0]
#     items_filename = index_prefix+'_metadata.pkl'
#     if not rebuild:
#         if os.path.exists(os.path.join(path, index_filename)) and os.path.exists(os.path.join(path, items_filename)):
#             index = faiss.read_index(os.path.join(path,index_filename))
#             items_df = pd.read_pickle(os.path.join(path, items_filename))
#             return index, items_df
#         else:
#             print("No Index exists, building...")

#     #only use files that start with the prefix:
#     file_list = [file for file in file_list if file.endswith(file_suffix) and not file.startswith(index_prefix)]

#     # Feature Extraction
#     features = []
#     items = []
#     for file in file_list:
#         feature_vector = extract_feature_func(os.path.join(path, file))
#         features.append(feature_vector)
#         cache = pickle.load(open(os.path.join(path, file), 'rb'))         
#         items.append([feature_vector,cache])

#     data = np.stack(features)  # Combine vectors into a NumPy array

#     # Build Faiss Index
#     dimension = data.shape[1]  
#     index = faiss.IndexFlatL2(dimension) 
#     index.add(data) 

#     #save index and file paths to file
#     faiss.write_index(index, os.path.join(path,index_filename))
#     items_df = pd.DataFrame(items,columns=['vector', 'item'])
#     items_df.to_pickle(os.path.join(path, items_filename))

#     return index, items_df


def load_nearest_neighbor_index(func, rebuild=False):
    code_str = get_source_recursive(func)
    func_hash = hash_code(code_str)

    path = os.path.join(util.CACHE_DIR, func.__module__, func.__name__)
    if not rebuild:
        if os.path.exists(os.path.join(path, CACHE_DATA_FILENAME)):
            if os.path.exists(os.path.join(path, CACHE_INDEX_FILENAME)):
                index = faiss.read_index(os.path.join(path, CACHE_INDEX_FILENAME))
                data_df = pd.read_pickle(os.path.join(path, CACHE_DATA_FILENAME))
                return index, data_df[data_df['data'].apply(lambda x: x['func_hash'] == func_hash)]
            else:
                print("No Index exists, building...")
        else:
            raise FileNotFoundError(f"No Cache Data exists: {os.path.join(path, CACHE_DATA_FILENAME)}")

    data_filename = os.path.join(path, CACHE_DATA_FILENAME)
    if os.path.exists(data_filename):
        data_df = pd.read_pickle(data_filename)
    else:
        data_df = pd.DataFrame()

    features = data_df['vector'].tolist()
    data = np.stack(features)  # Combine vectors into a NumPy array

    # Build Faiss Index
    dimension = data.shape[1]
    index = faiss.IndexFlatL2(dimension) 
    index.add(data)

    #save index and file paths to file
    faiss.write_index(index, os.path.join(path,CACHE_INDEX_FILENAME))

    return index, data_df


def get_nearest_cached(func, args, kwargs, k=1):

    index, items_df = load_nearest_neighbor_index(func)
    query_vector = np.array(flatten(tolist([args, kwargs]))).astype('float32')
    distances, indices = index.search(np.array([query_vector]), k)
    results = []
    indices[0][0]
    for i, d in zip(indices[0], distances[0]):
        res = items_df.iloc[i]['data']['result']
        results.append((d, res))
    if k == 1:
        return results[0]
    return results


def save_cached(func, args, kwargs, result):
    code_str = get_source_recursive(func)
    func_hash = hash_code(code_str)

    data = {
        '__module__':func.__module__,
        '__name__':func.__name__,
        'func_hash':func_hash, # allows detecting changes to the code
        'args':args,
        'kwargs':kwargs,
        'result': result
    }

    # save directly to metadata pickle
    data_filename = os.path.join(CACHE_DIR, func.__module__,func.__name__, CACHE_DATA_FILENAME)

    if os.path.exists(data_filename):
        df_existing = pd.read_pickle(data_filename)
    else:
        df_existing = pd.DataFrame()

    feature_vector = np.array(flatten(tolist([args, kwargs]))).astype('float32')

    df_new = pd.DataFrame({'vector': [feature_vector], 'data': [data]})
    # Append the new DataFrame to the existing DataFrame
    df_combined = pd.concat([df_existing,df_new], ignore_index=True)  # Reset index

    # Save the combined DataFrame to the pickle file
    print(f"Saving result to cache {data_filename}")
    os.makedirs(os.path.dirname(data_filename), exist_ok=True)
    df_combined.to_pickle(data_filename)

    #rebuild index?
    load_nearest_neighbor_index(func, rebuild=True)


def cache(func):
    @functools.wraps(func)
    def wrapper(*args, **kwargs):
        try:
            dist, res = get_nearest_cached(func, args, kwargs)
            if dist == 0:  # by default only accept exact matches
                return res
        except FileNotFoundError:
            print("No Cache found. Computing...")

        result = func(*args, **kwargs)
        save_cached(func, args, kwargs, result)
        return result
    return wrapper


@time_it
def minimize_cached(func, x, cache_tol=EPSILON, **kwargs):
    # create a unique filename from source code, and parameters

    x0 = x
    # does a nearest neighbor search to find the closest cached result
    try:
        dist, res = get_nearest_cached(func, None, kwargs)
        print(f"Loaded Cache Result guess: {res.x}\t distance: {dist}")
        if dist == 0:  # if exact match, return this result
            return res
        x0 = res.x
    except FileNotFoundError:
        print("No Cache found. Computing...")

    # compute minimization
    res = minimize(func, x0, **kwargs)

    # save the guess to cache only if 
    # minimization converged close to 0
    if res.fun < cache_tol:
        save_cached(func, None, kwargs, res)
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
