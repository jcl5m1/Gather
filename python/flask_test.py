from flask import Flask, render_template, jsonify
from pythreejs import Renderer, Scene, Camera, Mesh, BoxGeometry, MeshPhongMaterial
from ipywidgets.embed import embed_minimal_html
from ipywidgets import IntSlider

app = Flask(__name__)

@app.route('/')
def index():


    slider = IntSlider(value=40,layout={'width': '800px'})
    embed_minimal_html('templates/index.html', views=[slider], title='Widgets export')
    # scene = Scene()

    # # Create a cube
    # geometry = BoxGeometry(1, 1, 1)
    # material = MeshPhongMaterial(color='#aaaaaa')
    # cube = Mesh(geometry, material)

    # # Add the cube to the scene
    # scene.add(cube)

    # # Create a camera
    # camera = Camera(position=(0, 0, 10))

    # # Create a renderer
    # renderer = Renderer(scene=scene, camera=camera, controls=[],)

    # # Render the scene
    # renderer.render(scene, camera)

    # embed_minimal_html('templates/index2.html', views=[renderer], title='Widgets export')

    return render_template('index.html')

if __name__ == '__main__':
    app.run(debug=True)